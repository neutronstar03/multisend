import { describe, expect, test } from 'bun:test';
import { WalletSession, WALLET_KEY, type Wallet } from './wallet-session';
import type { EIP1193Provider } from 'viem';

const A='0x0000000000000000000000000000000000000001';
const B='0x0000000000000000000000000000000000000002';
function storage(saved: unknown = null) {
  const values=new Map<string,string>();
  if(saved)values.set(WALLET_KEY,JSON.stringify(saved));
  return {getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
}
function wallet(rdns='io.test.wallet',uuid='first') {
  const calls:string[]=[],events=new Map<string,()=>void>();
  const control={accounts:[A] as string[],chain:'0x1',reject:false,wait:null as Promise<string[]>|null};
  const provider={request:async({method}:{method:string})=>{
    calls.push(method);
    if(control.reject)throw Error('Unavailable');
    if(method==='eth_chainId')return control.chain;
    if(method==='eth_accounts'||method==='eth_requestAccounts')return control.wait??control.accounts;
    throw Error('Unexpected permission, signature or transaction method: '+method);
  },on:(event:string,listener:()=>void)=>{events.set(event,listener);}} as unknown as EIP1193Provider;
  return {entry:{uuid,rdns,name:rdns,provider} satisfies Wallet,calls,control,emit:(e:string)=>events.get(e)?.()};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const preference={rdns:'io.test.wallet',name:'Test wallet'};

describe('wallet session',()=>{
  test('first visit never requests accounts automatically',async()=>{
    const w=wallet(),s=new WalletSession(storage(),()=>{});s.announce(w.entry);await tick();
    expect(w.calls).toEqual([]);expect(s.state.phase).toBe('disconnected');
  });
  test('explicit connection remembers stable identity and a fresh instance restores with a new UUID',async()=>{
    const store=storage(),w=wallet(),s=new WalletSession(store,()=>{});s.announce(w.entry);await s.connect(w.entry);
    expect(w.calls).toEqual(['eth_requestAccounts','eth_chainId']);
    expect(JSON.parse(store.getItem(WALLET_KEY)!)).toEqual({rdns:w.entry.rdns,name:w.entry.name});
    const next=wallet('io.test.wallet','new-session-uuid'),restored=new WalletSession(store,()=>{});
    restored.announce(next.entry);await tick();expect(restored.state.account).toBe(A);
    expect(next.calls).toEqual(['eth_accounts','eth_chainId']);
  });
  test('does not silently select a different installed wallet, including delayed announcement',async()=>{
    const s=new WalletSession(storage(preference),()=>{}),other=wallet('other.wallet','other-uuid'),chosen=wallet();
    s.announce(other.entry);await tick();expect(other.calls).toEqual([]);expect(s.state.phase).toBe('unavailable');
    s.announce(chosen.entry);await tick();expect(s.state.wallet).toBe(chosen.entry);
  });
  test('locked and rejected providers show unavailable without a permission prompt',async()=>{
    for(const rejected of [false,true]){
      const w=wallet();w.control.accounts=[];w.control.reject=rejected;
      const s=new WalletSession(storage(preference),()=>{});s.announce(w.entry);await tick();
      expect(s.state.phase).toBe('unavailable');expect(s.state.account).toBeNull();expect(w.calls).toEqual(['eth_accounts']);
    }
  });
  test('account and chain events clear the old account immediately and silently refresh mainnet',async()=>{
    const states:string[]=[],w=wallet(),s=new WalletSession(storage(preference),x=>states.push(x.phase));
    s.announce(w.entry);await tick();w.control.accounts=[B];w.emit('accountsChanged');
    expect(s.state.account).toBeNull();await tick();expect(s.state.account).toBe(B);
    w.control.chain='0xa';w.emit('chainChanged');await tick();expect(s.state.phase).toBe('wrong-network');expect(s.state.account).toBeNull();
    w.control.chain='0x1';w.emit('chainChanged');await tick();expect(s.state.account).toBe(B);
    expect(states).toContain('restoring');expect(w.calls).not.toContain('eth_requestAccounts');
  });
  test('disconnect clears preference and cancels pending restore and later events',async()=>{
    const store=storage(preference),w=wallet();let finish!:(accounts:string[])=>void;
    w.control.wait=new Promise(resolve=>{finish=resolve;});
    const s=new WalletSession(store,()=>{});s.announce(w.entry);s.disconnect();finish([A]);await tick();w.emit('accountsChanged');
    expect(s.state.phase).toBe('disconnected');expect(store.getItem(WALLET_KEY)).toBeNull();
    const next=wallet(),reloaded=new WalletSession(store,()=>{});reloaded.announce(next.entry);await tick();expect(next.calls).toEqual([]);
    await reloaded.connect(next.entry);expect(reloaded.state.phase).toBe('connected');
  });
  test('an obsolete account read cannot overwrite a newer event',async()=>{
    const w=wallet();let finish!:(accounts:string[])=>void;w.control.wait=new Promise(resolve=>{finish=resolve;});
    const s=new WalletSession(storage(preference),()=>{});s.announce(w.entry);
    w.control.wait=null;w.control.accounts=[B];w.emit('accountsChanged');await tick();finish([A]);await tick();
    expect(s.state.account).toBe(B);
  });
  test('provider disconnect and empty accounts clear connection; inactive providers do not affect it',async()=>{
    const w=wallet(),other=wallet('other','other-uuid'),s=new WalletSession(storage(preference),()=>{});s.announce(w.entry);s.announce(other.entry);await tick();
    other.emit('disconnect');expect(s.state.account).toBe(A);w.emit('disconnect');expect(s.state.phase).toBe('unavailable');expect(s.state.account).toBeNull();
    w.control.accounts=[];w.emit('accountsChanged');await tick();expect(s.state.phase).toBe('unavailable');
  });
  test('accounts event during first connection still remembers the explicit wallet choice',async()=>{
    const store=storage(),w=wallet(),s=new WalletSession(store,()=>{});s.announce(w.entry);
    let finish!:(accounts:string[])=>void;w.control.wait=new Promise(resolve=>{finish=resolve;});
    const connecting=s.connect(w.entry);w.control.wait=null;w.emit('accountsChanged');await tick();finish([A]);await connecting;
    expect(s.state.account).toBe(A);expect(JSON.parse(store.getItem(WALLET_KEY)!)).toEqual({rdns:w.entry.rdns,name:w.entry.name});
  });
  test('invalid stored preference and inaccessible storage do not block manual connection',async()=>{
    const w=wallet(),s=new WalletSession(storage({uuid:'old-session'}),()=>{});s.announce(w.entry);await tick();expect(w.calls).toEqual([]);
    const bad={getItem:()=>{throw Error();},setItem:()=>{throw Error();},removeItem:()=>{throw Error();}};
    const session=new WalletSession(bad,()=>{});await session.connect(w.entry);expect(session.state.account).toBe(A);session.disconnect();
  });
});
