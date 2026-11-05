import { expect,test } from 'bun:test';
import { BatchPresets, applyGroup, PRESETS_KEY, type TokenGroup } from './presets';
import type { Token } from './discovery';
const A='0x0000000000000000000000000000000000000001',B='0x0000000000000000000000000000000000000002';
function store(value:string|null=null){return {getItem:()=>value,setItem:(_key:string,next:string)=>{value=next;}};}
const token={address:A,symbol:'T',name:'Token',decimals:2,balance:123n,allowance:0n,warning:null,source:'manual'} satisfies Token;
test('legacy set and recipient migrate once without resurrecting deleted groups',()=>{
 const storage=store(),p=new BatchPresets(storage,[A],B);expect(p.groups[0].addresses).toEqual([A]);expect(p.destinations[0].address).toBe(B);
 p.deleteGroup(p.groups[0].id);expect(new BatchPresets(storage,[A],B).groups).toEqual([]);expect(PRESETS_KEY).toBe('multisend.presets');
});
test('multiple groups and destinations support create, rename, choose data, delete and reload',()=>{
 const storage=store(),p=new BatchPresets(storage),g=p.addGroup('Rewards',[A,A]),second=p.addGroup('Other',[B]);p.renameGroup(g.id,'Monthly');
 const d=p.addDestination('Vault',B);p.renameDestination(d.id,'Treasury');
 const restored=new BatchPresets(storage);expect(restored.groups.map(x=>x.name)).toEqual(['Monthly','Other']);expect(restored.destinations[0].name).toBe('Treasury');
 p.deleteGroup(second.id);p.deleteDestination(d.id);expect(new BatchPresets(storage).groups).toHaveLength(1);expect(new BatchPresets(storage).destinations).toEqual([]);
});
test('names and destinations are validated and duplicate names/addresses are rejected',()=>{
 const p=new BatchPresets(store());expect(()=>p.addGroup(' ',[A])).toThrow('name');expect(()=>p.addGroup('Empty',[])).toThrow('Select');p.addGroup('Rewards',[A]);expect(()=>p.addGroup('rewards',[B])).toThrow('already exists');
 expect(()=>p.addDestination('Bad','no')).toThrow('valid nonzero');expect(()=>p.addDestination('Zero','0x0000000000000000000000000000000000000000')).toThrow('valid nonzero');p.addDestination('Vault',A);expect(()=>p.addDestination('Other',A)).toThrow('already saved');
});
test('adding group preserves all custom amounts and leaves newly selected amounts empty until explicit Max',()=>{
 const group:TokenGroup={id:'g',name:'Group',addresses:[A,B]},entered=new Map([[A,'0.25'],['outside','0.8']]);
 const result=applyGroup(group,[token],entered,'keep');expect(result.selected.get(A)).toBe('0.25');expect(result.selected.get('outside')).toBe('0.8');expect(result.missing).toEqual([B]);
 const empty=applyGroup(group,[token],new Map(),'keep');expect(empty.selected.get(A)).toBe('');
});
test('explicit Max replaces selection using current live balances, preserving precision and showing missing members',()=>{
 const group:TokenGroup={id:'g',name:'Group',addresses:[A,B]};const first=applyGroup(group,[token],new Map([[A,'0.01']]),'max');expect(first.selected.get(A)).toBe('1.23');expect(first.missing).toEqual([B]);
 expect(applyGroup(group,[{...token,balance:2n}],first.selected,'max').selected.get(A)).toBe('0.02');expect(applyGroup(group,[],first.selected,'max').selected.size).toBe(0);
});
test('malformed stored entries are filtered and only public preparation metadata is persisted',()=>{
 const p=new BatchPresets(store(JSON.stringify({version:1,groups:[{}, {id:'x',name:'Bad',addresses:['bad']}],destinations:[{id:'d',name:'Bad',address:'bad'}]})));expect(p.groups).toEqual([]);expect(p.destinations).toEqual([]);
 const storage=store(),good=new BatchPresets(storage);good.addGroup('A',[A]);expect(storage.getItem()).not.toContain('balance');expect(storage.getItem()).not.toContain('amount');
});
