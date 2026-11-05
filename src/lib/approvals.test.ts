import { expect, test } from 'bun:test';
import { PendingApprovals, approvalKey, type ApprovalScope } from './approvals';
const scope:ApprovalScope={chainId:1,account:'0x0000000000000000000000000000000000000001',spender:'0x0000000000000000000000000000000000000002',token:'0x0000000000000000000000000000000000000003'};
const hash=`0x${'1'.repeat(64)}` as const,next=`0x${'2'.repeat(64)}` as const;
function storage(value='[]'){return {getItem:()=>value,setItem:(_k:string,v:string)=>{value=v;}};}
const success={receipt:async()=>({status:'success' as const}),allowance:async()=>100n};
const failed=async():Promise<never>=>{throw Error('RPC timeout');};

test('restores validated public metadata and blocks duplicate approval before reconciliation',()=>{
 const store=storage(),p=new PendingApprovals(store),key=p.submit(scope,hash),restored=new PendingApprovals(store);
 expect(restored.transactions.get(key)).toBe(hash);expect(restored.records.get(key)?.outcome).toBe('unknown');
 expect(()=>restored.submit(scope,next)).toThrow('pending approval');
 expect(JSON.parse(store.getItem())[0]).toEqual({...scope,hash});
});
test('timeout, unavailable receipt and transport failure retain unresolved hashes across reload',async()=>{
 for(const receipt of [failed,async()=>null]){
  const store=storage(),p=new PendingApprovals(store),key=p.submit(scope,hash);
  await p.reconcile(key,{receipt,allowance:async()=>500n});
  expect(p.records.get(key)?.outcome).toBe('unknown');expect(p.transactions.get(key)).toBe(hash);
  expect(new PendingApprovals(store).transactions.get(key)).toBe(hash);
 }
});
test('successful receipt remains confirmed when allowance fails and can recover safely',async()=>{
 const p=new PendingApprovals(),key=p.submit(scope,hash);
 await p.reconcile(key,{receipt:success.receipt,allowance:failed});
 expect(p.records.get(key)?.outcome).toBe('confirmed');expect(p.describe(p.records.get(key)!)).toContain('allowance unavailable');expect(p.transactions.has(key)).toBe(true);
 await p.reconcile(key,{receipt:async()=>null,allowance:failed});expect(p.records.get(key)?.outcome).toBe('confirmed');
 await p.reconcile(key,success);expect(p.transactions.has(key)).toBe(false);expect(p.allowance(key)).toBe(100n);
});
test('reverted receipt is terminal even if another approval supplies sufficient allowance',async()=>{
 const p=new PendingApprovals(),key=p.submit(scope,hash);
 await p.reconcile(key,{receipt:async()=>({status:'reverted'}),allowance:async()=>100n});
 expect(p.records.get(key)?.outcome).toBe('reverted');expect(p.transactions.has(key)).toBe(false);
 p.submit(scope,next);expect(p.transactions.get(key)).toBe(next);
});
test('repricing follows the new hash, and known replacement/cancellation remain distinct after reload',async()=>{
 for(const reason of ['repriced','replaced','cancelled'] as const){
  const store=storage(),p=new PendingApprovals(store),key=p.submit(scope,hash);p.replace(key,next,reason);
  let seen='';await p.reconcile(key,{receipt:async h=>{seen=h;return {status:'success'};},allowance:async()=>0n});
  expect(seen).toBe(next);expect(p.records.get(key)?.previousHash).toBe(hash);
  expect(p.records.get(key)?.outcome).toBe(reason==='repriced'?'confirmed':reason);
  expect(p.allowance(key)).toBe(0n);
  if(reason!=='repriced')expect(new PendingApprovals(store).records.get(key)?.outcome).toBe(reason);
 }
});
test('replacement callback while waiting is retained and its receipt cannot be mistaken for original approval success',async()=>{
 const p=new PendingApprovals(),key=p.submit(scope,hash);
 await p.reconcile(key,{receipt:async()=>{p.replace(key,next,'cancelled');return {status:'success'};},allowance:async()=>0n});
 expect(p.records.get(key)?.outcome).toBe('cancelled');expect(p.transactions.size).toBe(0);
});
test('parallel confirmations settle independently and scope includes chain/account/token/spender',async()=>{
 const p=new PendingApprovals(),other={...scope,token:'0x0000000000000000000000000000000000000004' as const};
 const a=p.submit(scope,hash),b=p.submit(other,next),wait=Promise.withResolvers<{status:'success'}>();
 const first=p.reconcile(a,{receipt:()=>wait.promise,allowance:async()=>100n});await p.reconcile(b,success);
 expect(p.transactions.has(a)).toBe(true);expect(p.transactions.has(b)).toBe(false);
 expect(p.count('1:'+scope.account+':'+scope.spender+':')).toBe(1);
 expect(p.count('1:'+other.token+':')).toBe(0);expect(p.count('10:')).toBe(0);
 wait.resolve({status:'success'});await first;expect(p.transactions.size).toBe(0);
});
test('new allowance revisions, including zero resets, survive stale inventory scans and stay scoped',()=>{
 const p=new PendingApprovals(),key=approvalKey(scope),revision=p.revision;p.recordAllowance(key,0n);
 expect(p.allowanceSince(key,revision)).toBe(0n);expect(p.allowanceSince(approvalKey({...scope,account:scope.token}),revision)).toBeUndefined();
});
test('malformed storage and unsupported chains are ignored; storage failures stay visible',()=>{
 const valid={...scope,hash};const bad=[null,{}, {...valid,chainId:10},{...valid,account:'bad'},{...valid,token:'0x0000000000000000000000000000000000000000'},{...valid,hash:'0x01'}];
 expect(new PendingApprovals(storage(JSON.stringify(bad))).records.size).toBe(0);
 expect(new PendingApprovals(storage('bad json')).storageWarning).toBeTruthy();
 const p=new PendingApprovals({getItem:()=>null,setItem:()=>{throw Error();}});p.submit(scope,hash);expect(p.storageWarning).toContain('could not be saved');
});
