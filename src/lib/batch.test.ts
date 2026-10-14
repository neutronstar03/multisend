import { describe, expect, test } from 'bun:test';
import { maxUint256, type Address } from 'viem';
import { approvalAmount, batchFingerprint, parseAmount, validateBatch } from './batch';
import type { Token } from './discovery';

const owner: Address = '0x1111111111111111111111111111111111111111';
const recipient: Address = '0x2222222222222222222222222222222222222222';
const token: Token = { address:'0x3333333333333333333333333333333333333333', name:'Token', symbol:'T', decimals:6, balance:1000001n, allowance:1000001n, warning:null, source:'manual' };
describe('batch preparation',()=>{
  test('preserves dust and full precision',()=>expect(parseAmount('0.000001',6,1n)).toBe(1n));
  test('rejects rounding, scientific notation, excess and zero',()=>{
    for(const value of ['0.0000001','1e-6','2','0','-1','Infinity']) expect(()=>parseAmount(value,6,1000001n)).toThrow();
  });
  test('rejects absent approvals, duplicate assets and self transfers',()=>{
    expect(()=>validateBatch(recipient,owner,[{token:{...token,allowance:null},amount:1n}])).toThrow();
    expect(()=>validateBatch(recipient,owner,[{token,amount:1n},{token,amount:1n}])).toThrow();
    expect(()=>validateBatch(owner,owner,[{token,amount:1n}])).toThrow();
  });
  test('confirmation identity changes with amounts or recipient',()=>{
    const first=batchFingerprint(owner,token.address,recipient,[{token,amount:1n}]);
    expect(first).not.toBe(batchFingerprint(owner,token.address,recipient,[{token,amount:2n}]));
    expect(first).not.toBe(batchFingerprint(owner,token.address,owner,[{token,amount:1n}]));
  });
  test('exact vs unlimited approval',()=>{
    expect(approvalAmount(12n,false)).toBe(12n); expect(approvalAmount(12n,true)).toBe(maxUint256);
  });
});
