import type { Hex } from 'viem';

export class PendingApprovals {
  readonly transactions = new Map<string, Hex>();
  revision = 0;
  private readonly allowances = new Map<string, { revision: number; value: bigint }>();

  count(scope: string): number {
    return [...this.transactions.keys()].filter(key => key.startsWith(scope)).length;
  }

  recordAllowance(key: string, value: bigint): void {
    this.allowances.set(key, { revision: ++this.revision, value });
  }

  allowanceSince(key: string, revision: number): bigint | undefined {
    const latest = this.allowances.get(key);
    return latest && latest.revision > revision ? latest.value : undefined;
  }

  async track(key: string, hash: Hex, confirm: (hash: Hex) => Promise<void>): Promise<void> {
    if (this.transactions.has(key)) throw new Error('This token already has a pending approval.');
    this.transactions.set(key, hash);
    try { await confirm(hash); }
    finally { this.transactions.delete(key); }
  }
}
