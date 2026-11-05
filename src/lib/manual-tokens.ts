import { getAddress, isAddress, zeroAddress, type Address, type Hex } from 'viem';
import { sanitizeTokenText } from './discovery';
export function normalizeManual(values: readonly string[]): Address[] {
  return [...new Set(values.filter(v=>isAddress(v)&&getAddress(v)!==zeroAddress).map(v=>getAddress(v)))];
}
export async function verifyManualToken(value:string,reads:{code:(address:Address)=>Promise<Hex|undefined>;decimals:(address:Address)=>Promise<number>;symbol:(address:Address)=>Promise<string>;balance:(address:Address)=>Promise<bigint>}) {
  if(!isAddress(value)||getAddress(value)===zeroAddress)throw new Error('Enter a valid nonzero ERC-20 contract address.');
  const address=getAddress(value);
  let code:Hex|undefined;
  try{code=await reads.code(address);}catch{throw new Error('RPC lookup failed. The address was not saved; retry when the RPC is available.');}
  if(!code||code==='0x')throw new Error('No contract code exists at this mainnet address. It was not saved.');
  let decimals:number,balance:bigint;
  try{[decimals,balance]=await Promise.all([reads.decimals(address),reads.balance(address)]);}catch{throw new Error('Could not verify ERC-20 decimals and balance. This may be a non-token contract or an RPC failure; the address was not saved.');}
  if(!Number.isInteger(decimals)||decimals<0||decimals>255||balance<0n)throw new Error('Invalid ERC-20 metadata or balance; the address was not saved.');
  let symbol:string|null=null;try{symbol=sanitizeTokenText(await reads.symbol(address));}catch{/* A label is optional; never claim it was verified. */}
  return {address,balance,symbol};
}
