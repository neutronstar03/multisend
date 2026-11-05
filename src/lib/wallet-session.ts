import { getAddress, isAddress, type Address, type EIP1193Provider } from 'viem';

export type Wallet = { uuid: string; rdns: string; name: string; provider: EIP1193Provider };
type Preference = { rdns: string; name: string };
export type SessionState = {
  phase: 'disconnected' | 'restoring' | 'connecting' | 'connected' | 'unavailable' | 'wrong-network';
  wallet: Wallet | null;
  account: Address | null;
  message: string;
};
export const WALLET_KEY = 'multisend.wallet';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only wallet identity is persisted. Accounts, balances and reviewed batches are never saved. */
export class WalletSession {
  readonly wallets: Wallet[] = [];
  state: SessionState;
  private preference: Preference | null = null;
  private revision = 0;
  private rememberChoice = false;
  private chosen: Wallet | null = null;

  constructor(private storage: Storage, private changed: (state: SessionState) => void) {
    try {
      const value: unknown = JSON.parse(storage.getItem(WALLET_KEY) ?? 'null');
      if (value && typeof value === 'object' && 'rdns' in value && typeof value.rdns === 'string' && value.rdns && 'name' in value && typeof value.name === 'string') {
        this.preference = { rdns: value.rdns, name: value.name };
      }
    } catch { /* Storage unavailable or invalid: stay disconnected. */ }
    this.state = { phase: this.preference ? 'unavailable' : 'disconnected', wallet: null, account: null,
      message: this.preference ? `${this.preference.name} is unavailable. Enable or unlock it, or choose a wallet and press Connect.` : 'Connect a wallet to load its Ethereum balances.' };
  }

  private publish(phase: SessionState['phase'], wallet: Wallet | null, account: Address | null, message: string) {
    this.state = { phase, wallet, account, message };
    this.changed(this.state);
  }

  announce(wallet: Wallet) {
    if (!wallet.uuid || !wallet.rdns || !wallet.name || typeof wallet.provider?.request !== 'function' || this.wallets.some(w => w.uuid === wallet.uuid)) return;
    this.wallets.push(wallet);
    const provider = wallet.provider as EIP1193Provider & { on?: (event: string, listener: () => void) => void };
    const refresh = () => { if (this.chosen === wallet) void this.read(wallet, false); };
    provider.on?.('accountsChanged', refresh);
    provider.on?.('chainChanged', refresh);
    provider.on?.('connect', refresh);
    provider.on?.('disconnect', () => {
      if (this.chosen !== wallet) return;
      this.revision++;
      this.publish('unavailable', wallet, null, `${wallet.name} disconnected. Unlock it or press Connect to retry.`);
    });
    // EIP-6963 UUIDs change between sessions; rdns identifies the user's wallet choice.
    if (!this.chosen && this.preference?.rdns === wallet.rdns) {
      this.chosen = wallet;
      void this.read(wallet, false);
    }
  }

  async connect(wallet: Wallet) {
    this.chosen = wallet;
    this.rememberChoice = true;
    await this.read(wallet, true);
  }

  private async read(wallet: Wallet, explicit: boolean) {
    const revision = ++this.revision;
    this.publish(explicit ? 'connecting' : 'restoring', wallet, null,
      explicit ? `Connecting to ${wallet.name}…` : `Restoring ${wallet.name} without requesting permissions…`);
    try {
      const accounts: unknown = await wallet.provider.request({ method: explicit ? 'eth_requestAccounts' : 'eth_accounts' });
      if (revision !== this.revision) return;
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !isAddress(accounts[0])) {
        this.publish('unavailable', wallet, null, `${wallet.name} is locked or account access is unavailable. Unlock it and press Connect.`);
        return;
      }
      if (this.rememberChoice) {
        this.rememberChoice = false;
        this.preference = { rdns: wallet.rdns, name: wallet.name };
        try { this.storage.setItem(WALLET_KEY, JSON.stringify(this.preference)); } catch { /* Connection can still work without persistence. */ }
      }
      const chain: unknown = await wallet.provider.request({ method: 'eth_chainId' });
      if (revision !== this.revision) return;
      if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== 1n) {
        this.publish('wrong-network', wallet, null, `Switch ${wallet.name} to Ethereum mainnet to load balances.`);
        return;
      }
      this.publish('connected', wallet, getAddress(accounts[0]), `Connected to ${wallet.name} on Ethereum mainnet.`);
    } catch {
      if (revision === this.revision) this.publish('unavailable', wallet, null, `${wallet.name} could not connect. Unlock it or press Connect to retry.`);
    }
  }

  disconnect() {
    this.revision++;
    this.chosen = null;
    this.preference = null;
    this.rememberChoice = false;
    let cleared = true;
    try { this.storage.removeItem(WALLET_KEY); } catch { cleared = false; }
    this.publish('disconnected', null, null, cleared ? 'Disconnected. Automatic reconnection is off until you connect again.' : 'Disconnected for this visit. Browser storage could not clear the wallet preference; clear site data to prevent reconnection on later visits.');
  }
}
