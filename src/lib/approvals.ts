import { isAddress, zeroAddress, type Address, type Hex } from 'viem';

export type ApprovalScope = { chainId: 1; account: Address; spender: Address; token: Address };
type Outcome = 'pending' | 'unknown' | 'confirmed' | 'reverted' | 'replaced' | 'cancelled';
export type ApprovalRecord = ApprovalScope & { hash: Hex; previousHash?: Hex; outcome: Outcome; allowanceFresh: boolean };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export const APPROVALS_KEY = 'multisend.approvals';
export const approvalKey = (scope: ApprovalScope) => `${scope.chainId}:${scope.account.toLowerCase()}:${scope.spender.toLowerCase()}:${scope.token.toLowerCase()}`;
type Receipt = { status: 'success' | 'reverted' };
export type Reconcile = {
  receipt: (hash: Hex) => Promise<Receipt | null>;
  allowance: (scope: ApprovalScope) => Promise<bigint>;
};
const hashValid = (value: unknown): value is Hex => typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value);
const addressValid = (value: unknown): value is Address => typeof value === 'string' && isAddress(value) && value.toLowerCase() !== zeroAddress;

export class PendingApprovals {
  readonly transactions = new Map<string, Hex>();
  readonly records = new Map<string, ApprovalRecord>();
  revision = 0;
  storageWarning = '';
  private readonly checking = new Set<string>();
  private readonly allowances = new Map<string, { revision: number; value: bigint }>();

  constructor(private storage?: Store) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(APPROVALS_KEY) ?? '[]');
      if (!Array.isArray(saved)) return;
      for (const raw of saved) {
        if (!raw || typeof raw !== 'object' || raw.chainId !== 1 || !addressValid(raw.account) || !addressValid(raw.spender) || !addressValid(raw.token) || !hashValid(raw.hash)) continue;
        const record: ApprovalRecord = {chainId:1,account:raw.account,spender:raw.spender,token:raw.token,hash:raw.hash,outcome:raw.outcome === 'cancelled' || raw.outcome === 'replaced' ? raw.outcome : 'unknown',allowanceFresh:false};
        if (hashValid(raw.previousHash)) record.previousHash=raw.previousHash;
        const key=approvalKey(record);this.records.set(key,record);this.sync(key,record);
      }
    } catch { this.storageWarning='Approval recovery storage could not be read. Check submitted hashes before retrying.'; }
  }

  private sync(key: string, record: ApprovalRecord) {
    if (record.outcome === 'pending' || record.outcome === 'unknown' || (record.outcome === 'confirmed' && !record.allowanceFresh)) this.transactions.set(key,record.hash);
    else this.transactions.delete(key);
  }

  private save() {
    try {
      // Store public transaction metadata only, never balances, amounts, credentials or signatures.
      this.storage?.setItem(APPROVALS_KEY,JSON.stringify([...this.records.values()].map(r=>({chainId:r.chainId,account:r.account,spender:r.spender,token:r.token,hash:r.hash,previousHash:r.previousHash,...(r.outcome==='cancelled'||r.outcome==='replaced'?{outcome:r.outcome}:{})}))));
    } catch { this.storageWarning='Approval tracking could not be saved. Keep the submitted hash before reloading.'; }
  }

  submit(scope: ApprovalScope, hash: Hex): string {
    const key=approvalKey(scope);
    if (this.transactions.has(key)) throw new Error('This token already has a pending approval. Check its tracked transaction first.');
    if (!hashValid(hash)) throw new Error('Invalid approval transaction hash.');
    const record: ApprovalRecord={...scope,hash,outcome:'pending',allowanceFresh:false};
    this.records.set(key,record);this.sync(key,record);this.save();return key;
  }

  replace(key: string, hash: Hex, reason: 'repriced' | 'replaced' | 'cancelled') {
    const record=this.records.get(key);if(!record || !hashValid(hash))return;
    record.previousHash=record.hash;record.hash=hash;
    record.outcome=reason==='repriced'?'pending':reason;record.allowanceFresh=false;
    this.sync(key,record);this.save();
  }

  async reconcile(key: string, deps: Reconcile): Promise<void> {
    const record=this.records.get(key);if(!record||this.checking.has(key))return;
    this.checking.add(key);
    try {
      try {
        const receipt=await deps.receipt(record.hash);
        // Replacement events may have changed this same record while waiting.
        if(record.outcome!=='cancelled'&&record.outcome!=='replaced')record.outcome=receipt?receipt.status==='success'?'confirmed':'reverted':record.outcome==='confirmed'||record.outcome==='reverted'?record.outcome:'unknown';
      } catch { if(record.outcome!=='confirmed'&&record.outcome!=='reverted'&&record.outcome!=='cancelled'&&record.outcome!=='replaced')record.outcome='unknown'; }
      try { this.recordAllowance(key,await deps.allowance(record));record.allowanceFresh=true; }
      catch { record.allowanceFresh=false; }
      if(this.records.get(key)===record){this.sync(key,record);this.save();}
    } finally { this.checking.delete(key); }
  }

  count(scope: string): number { return [...this.transactions.keys()].filter(key=>key.startsWith(scope)).length; }
  recordAllowance(key: string, value: bigint): void { this.allowances.set(key,{revision:++this.revision,value}); }
  allowanceSince(key: string, revision: number): bigint | undefined {
    const latest=this.allowances.get(key);return latest && latest.revision>revision?latest.value:undefined;
  }
  allowance(key: string): bigint | undefined { return this.allowances.get(key)?.value; }
  describe(record: ApprovalRecord): string {
    if(record.outcome==='confirmed')return record.allowanceFresh?'Confirmed; current allowance refreshed.':'Transaction confirmed; allowance unavailable. Check again before retrying.';
    if(record.outcome==='reverted')return 'Transaction reverted. A new approval requires your confirmation.';
    if(record.outcome==='cancelled')return 'Known cancellation. Current allowance is independent of this transaction.';
    if(record.outcome==='replaced')return 'Known replacement with a different transaction. Do not assume the approval succeeded.';
    return record.outcome==='pending'?'Submitted; waiting for confirmation.':'Outcome unknown (pending, unavailable or replaced without reliable details). Check again; do not duplicate the approval.';
  }
}
