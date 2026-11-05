import { expect, test } from 'bun:test';
import { normalizeManual, verifyManualToken } from './manual-tokens';
const address='0x0000000000000000000000000000000000000001';
const reads={code:async()=> '0x01' as const,decimals:async()=>18,balance:async()=>0n,symbol:async()=> 'TEST'};
test('manual normalization preserves legacy addresses and deduplicates checksummed and lowercase forms',()=>{
 expect(normalizeManual([address,address,'invalid','0x0000000000000000000000000000000000000000'])).toEqual([address]);
});
test('valid zero-balance token is saved for discovery, with separately verified label',async()=>{
 expect(await verifyManualToken(address,reads)).toEqual({address,balance:0n,symbol:'TEST'});
 const result=await verifyManualToken(address,{...reads,symbol:async()=>{throw Error();}});expect(result.symbol).toBeNull();
});
test('invalid address, EOA, metadata/RPC failures never become verified tokens',async()=>{
 await expect(verifyManualToken('invalid',reads)).rejects.toThrow('valid nonzero');
 await expect(verifyManualToken(address,{...reads,code:async()=> '0x'})).rejects.toThrow('No contract code');
 await expect(verifyManualToken(address,{...reads,decimals:async()=>{throw Error();}})).rejects.toThrow('Could not verify');
 await expect(verifyManualToken(address,{...reads,code:async()=>{throw Error();}})).rejects.toThrow('RPC lookup failed');
});
