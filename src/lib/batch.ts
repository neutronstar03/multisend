import { getAddress, isAddress, maxUint256, parseUnits, zeroAddress, type Address } from 'viem';
import type { Token } from './discovery';
import artifact from '../contract.json';

export const MAX_TOKENS=artifact.maxTokens;

export type SelectedToken = { token: Token; amount: bigint };
export function parseAmount(value: string, decimals: number, balance: bigint): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error('Enter a positive decimal amount.');
  if ((value.split('.')[1]?.length ?? 0) > decimals) throw new Error(`This token supports at most ${decimals} decimal places.`);
  const amount = parseUnits(value, decimals);
  if (amount <= 0n) throw new Error('Amount must be greater than zero.');
  if (amount > balance) throw new Error('Amount exceeds the wallet balance.');
  return amount;
}
export function validateBatch(recipient: string, owner: Address, items: SelectedToken[]) {
  if (!isAddress(recipient) || getAddress(recipient) === zeroAddress) throw new Error('Enter a valid, nonzero recipient address.');
  if (getAddress(recipient) === getAddress(owner)) throw new Error('Recipient is the sending wallet. Choose a different address.');
  if (!items.length || items.length > MAX_TOKENS) throw new Error(`Select between 1 and ${MAX_TOKENS} tokens.`);
  if (new Set(items.map(i => i.token.address.toLowerCase())).size !== items.length) throw new Error('Duplicate token addresses.');
  for (const { token, amount } of items) {
    if (amount <= 0n || amount > token.balance) throw new Error(`Invalid amount for ${token.symbol}.`);
    if (token.allowance === null || token.allowance < amount) throw new Error(`${token.symbol} needs an approval before simulation.`);
  }
  return getAddress(recipient);
}
export const approvalAmount = (amount: bigint, unlimited: boolean) => unlimited ? maxUint256 : amount;
export function batchFingerprint(owner: Address, spender: Address, recipient: Address, items: SelectedToken[]): string {
  return JSON.stringify([owner.toLowerCase(), spender.toLowerCase(), recipient.toLowerCase(), items.map(i=>[i.token.address.toLowerCase(),i.amount.toString()])]);
}
