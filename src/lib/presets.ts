import { formatUnits, getAddress, isAddress, zeroAddress, type Address } from 'viem';
import type { Token } from './discovery';
import { normalizeManual } from './manual-tokens';
export type TokenGroup={id:string;name:string;addresses:Address[]};
export type Destination={id:string;name:string;address:Address};
export const PRESETS_KEY='multisend.presets';
type Store=Pick<Storage,'getItem'|'setItem'>;
function nameValue(value:string){const name=value.trim();if(!name||name.length>80)throw new Error('Use a name between 1 and 80 characters.');return name;}
function recipient(value:string):Address{if(!isAddress(value)||getAddress(value)===zeroAddress)throw new Error('Enter a valid nonzero Ethereum destination address.');return getAddress(value);}
export class BatchPresets{
 groups:TokenGroup[]=[];
 destinations:Destination[]=[];
 warning='';
 constructor(private store:Store,legacySet:string[]=[],legacyRecipient=''){
  try{
   const raw:unknown=JSON.parse(store.getItem(PRESETS_KEY)??'null');
   if(raw&&typeof raw==='object'&&'version'in raw&&raw.version===1&&'groups'in raw&&Array.isArray(raw.groups)&&'destinations'in raw&&Array.isArray(raw.destinations)){
    const ids=new Set<string>();
    for(const group of raw.groups){
     if(!group||typeof group!=='object'||typeof group.id!=='string'||ids.has(group.id)||typeof group.name!=='string'||!Array.isArray(group.addresses))continue;
     try{const name=nameValue(group.name),addresses=normalizeManual(group.addresses.filter((a:unknown):a is string=>typeof a==='string'));if(!addresses.length)continue;this.groups.push({id:group.id,name,addresses});ids.add(group.id);}catch{/* Ignore invalid records. */}
    }
    ids.clear();
    for(const dest of raw.destinations){
     if(!dest||typeof dest!=='object'||typeof dest.id!=='string'||ids.has(dest.id)||typeof dest.name!=='string'||typeof dest.address!=='string')continue;
     try{this.destinations.push({id:dest.id,name:nameValue(dest.name),address:recipient(dest.address)});ids.add(dest.id);}catch{/* Ignore invalid records. */}
    }
    return;
   }
  }catch{this.warning='Saved groups/destinations could not be read. Existing legacy preferences remain available.';}
  const addresses=normalizeManual(legacySet);if(addresses.length)this.groups.push({id:'legacy-set',name:'Saved token set',addresses});
  try{if(legacyRecipient)this.destinations.push({id:'legacy-recipient',name:'Remembered recipient',address:recipient(legacyRecipient)});}catch{/* Invalid legacy recipient stays in settings for correction. */}
  this.save();
 }
 private save(){try{this.store.setItem(PRESETS_KEY,JSON.stringify({version:1,groups:this.groups,destinations:this.destinations}));}catch{this.warning='Changes could not be saved in this browser. Keep this page open or restore browser storage before reloading.';}}
 private unique(name:string,list:{id:string;name:string}[],except=''){if(list.some(x=>x.id!==except&&x.name.toLowerCase()===name.toLowerCase()))throw new Error('That name already exists. Choose a different name.');}
 addGroup(value:string,values:readonly string[]){const name=nameValue(value);this.unique(name,this.groups);const addresses=normalizeManual(values);if(!addresses.length)throw new Error('Select at least one held token before saving a group.');const group={id:crypto.randomUUID(),name,addresses};this.groups.push(group);this.save();return group;}
 renameGroup(id:string,value:string){const group=this.groups.find(x=>x.id===id);if(!group)throw new Error('Choose a group first.');const name=nameValue(value);this.unique(name,this.groups,id);group.name=name;this.save();}
 deleteGroup(id:string){this.groups=this.groups.filter(x=>x.id!==id);this.save();}
 addDestination(value:string,addressValue:string){const name=nameValue(value),address=recipient(addressValue);this.unique(name,this.destinations);if(this.destinations.some(d=>d.address.toLowerCase()===address.toLowerCase()))throw new Error('That destination address is already saved. Rename the existing destination instead.');const destination={id:crypto.randomUUID(),name,address};this.destinations.push(destination);this.save();return destination;}
 renameDestination(id:string,value:string){const dest=this.destinations.find(x=>x.id===id);if(!dest)throw new Error('Choose a destination first.');const name=nameValue(value);this.unique(name,this.destinations,id);dest.name=name;this.save();}
 deleteDestination(id:string){this.destinations=this.destinations.filter(x=>x.id!==id);this.save();}
}
export function applyGroup(group:TokenGroup,inventory:readonly Token[],entered:ReadonlyMap<string,string>,mode:'keep'|'max'){
 const held=inventory.filter(t=>t.balance>0n&&group.addresses.some(a=>a.toLowerCase()===t.address.toLowerCase()));
 const missing=group.addresses.filter(a=>!held.some(t=>t.address.toLowerCase()===a.toLowerCase()));
 const selected=mode==='keep'?new Map(entered):new Map<string,string>();
 for(const token of held){const address=token.address.toLowerCase();if(mode==='max')selected.set(address,formatUnits(token.balance,token.decimals));else if(!selected.has(address))selected.set(address,'');}
 return {selected,held:held.map(t=>t.address),missing};
}
