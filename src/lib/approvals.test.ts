import { expect, test } from 'bun:test';
import { PendingApprovals } from './approvals';

test('approval receipts settle independently and retain their own transaction hash', async () => {
  const pending = new PendingApprovals();
  const first = Promise.withResolvers<void>(), second = Promise.withResolvers<void>();
  const seen: string[] = [];
  const a = pending.track('token-a', '0x01', async hash => { seen.push(hash); await first.promise; });
  const b = pending.track('token-b', '0x02', async hash => { seen.push(hash); await second.promise; });
  expect(seen).toEqual(['0x01', '0x02']);
  await expect(pending.track('token-a', '0x03', async () => {})).rejects.toThrow('pending approval');
  second.resolve(); await b;
  expect(pending.transactions.get('token-a')).toBe('0x01');
  expect(pending.transactions.has('token-b')).toBe(false);
  first.reject(new Error('Transaction reverted'));
  await expect(a).rejects.toThrow('reverted');
  expect(pending.transactions.size).toBe(0);
});

test('a delayed inventory scan keeps allowances confirmed since it started, including resets', () => {
  const pending = new PendingApprovals();
  const scanRevision = pending.revision;
  pending.recordAllowance('wallet:contract:token-a', 100n);
  pending.recordAllowance('wallet:contract:token-b', 0n);
  expect(pending.allowanceSince('wallet:contract:token-a', scanRevision)).toBe(100n);
  expect(pending.allowanceSince('wallet:contract:token-b', scanRevision)).toBe(0n);
  expect(pending.allowanceSince('other-wallet:contract:token-a', scanRevision)).toBeUndefined();
  expect(pending.allowanceSince('wallet:contract:token-a', pending.revision)).toBeUndefined();
});

test('pending receipts from another wallet do not lock the active wallet', async () => {
  const pending = new PendingApprovals(), receipt = Promise.withResolvers<void>();
  const wait = pending.track('wallet-a:contract:token', '0x01', () => receipt.promise);
  expect(pending.count('wallet-a:contract:')).toBe(1);
  expect(pending.count('wallet-b:contract:')).toBe(0);
  expect(pending.count('wallet-a:other-contract:')).toBe(0);
  receipt.resolve(); await wait;
});
