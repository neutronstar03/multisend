/**
 * Static-browser ERC-20 discovery for the multisend dapp.
 *
 * Candidate addresses come from an indexer (Alchemy token balances API when a key
 * is configured, otherwise Etherscan v2 account tokentx), merged with a curated
 * mainnet catalogue and the caller's manual addresses. Labels returned by an
 * indexer are never trusted: symbol, name, decimals, balance and allowance are
 * read on chain with batched multicall calls pinned to a single block.
 *
 * Result contract:
 * - 'complete: false' means the list can be partial: no indexer configured, a
 *   discovery cap was hit, an indexer/network/JSON error occurred, the block pin
 *   failed, or a token balance, decimals or allowance read failed. These failures
 *   are also described in 'issues'.
 * - 'warning' flags restricted transfers and tokens whose on-chain label is
 *   unusable (the contract address is shown instead).
 * - Zero balances are dropped; dust is always kept.
 * - Source precedence when the same address arrives from several places:
 *   indexed > manual > known.
 */
import { getAddress, hexToString, isAddress, type Address, type PublicClient } from 'viem';

export type Token = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  balance: bigint;
  allowance: bigint | null;
  warning: string | null;
  source: 'indexed' | 'known' | 'manual';
};

export type DiscoveryOptions = {
  alchemyKey: string;
  etherscanKey: string;
  spender: Address | null;
  manualAddresses: Address[];
};

export type DiscoveryResult = {
  tokens: Token[];
  issues: string[];
  complete: boolean;
};

export type DiscoveryDeps = {
  fetch?: typeof fetch;
};

export const DISCOVERY_LIMITS = {
  alchemyMaxTokens: 2000,
  alchemyMaxPages: 32,
  etherscanPageSize: 1000,
  etherscanMaxPages: 20,
  metadataChunkTokens: 60,
  balanceChunkTokens: 200,
  allowanceChunkTokens: 200,
} as const;

export const NO_INDEXER_ISSUE = 'Known tokens only; configure an indexer to discover all tokens.';

export type KnownToken = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
};

/**
 * Curated mainnet catalogue. Labels and decimals were verified on chain; the
 * decimals are only used as a fallback when decimals() cannot be read live.
 */
export const KNOWN_TOKENS: readonly KnownToken[] = [
  { address: '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b', symbol: 'CVX', name: 'Convex Token', decimals: 18 },
  { address: '0xd533a949740bb3306d119cc777fa900ba034cd52', symbol: 'CRV', name: 'Curve DAO Token', decimals: 18 },
  { address: '0xf939e0a03fb07f59a73314e73794be0e57ac1b4e', symbol: 'crvUSD', name: 'Curve.Fi USD Stablecoin', decimals: 18 },
  { address: '0x6440f144b7e50d6a8439336510312d2f54beb01d', symbol: 'BOLD', name: 'BOLD Stablecoin', decimals: 18 },
  { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
  { address: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
  { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  { address: '0x01791f726b4103694969820be083196cc7c045ff', symbol: 'YB', name: 'Yield Basis', decimals: 18 },
  { address: '0x04acaf8d2865c0714f79da09645c13fd2888977f', symbol: 'WFRAX', name: 'Wrapped Frax', decimals: 18 },
  { address: '0x419905009e4656fdc02418c7df35b1e61ed5f726', symbol: 'RSUP', name: 'Resupply', decimals: 18 },
  { address: '0x365accfca291e7d3914637abf1f7635db165bb09', symbol: 'FXN', name: 'FXN Token', decimals: 18 },
  { address: '0xf4c13d631450de6b12a19829e37c8e2826891dc4', symbol: 'avUSD', name: 'avUSD', decimals: 18 },
  { address: '0x501ebf66d76a96d4fb26ccead42957653e16b8b8', symbol: 'evaUSDT', name: 'evaUSDT', decimals: 6 },
  { address: '0xcacd6fd266af91b8aed52accc382b4e165586e29', symbol: 'frxUSD', name: 'Frax USD', decimals: 18 },
  { address: '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee', symbol: 'weETH', name: 'Wrapped eETH', decimals: 18 },
  { address: '0x069662d2588fcac24b5c209456db965d151556f0', symbol: 'ApyxUSDC', name: 'Apyx USDC', decimals: 18 },
  { address: '0xaf5372792a29dc6b296d6ffd4aa3386aff8f9bb2', symbol: 'eRLUSD-7', name: 'EVK Vault eRLUSD-7', decimals: 18 },
  { address: '0x2f849ba554c1ea2ede9c240bbe9d247dd6ec8a6b', symbol: 'esUSDf-1', name: 'EVK Vault esUSDf-1', decimals: 18 },
  { address: '0x7ac81b3172870397496bd30502a07cc9bfbb25ee', symbol: 'eUSDf-2', name: 'EVK Vault eUSDf-2', decimals: 18 },
  { address: '0xf3e621395fc714b90da337aa9108771597b4e696', symbol: 'rEUL', name: 'Reward EUL', decimals: 18 },
  { address: '0xc8cf6d7991f15525488b2a83df53468d682ba4b0', symbol: 'sUSDf', name: 'Staked Falcon USD', decimals: 18 },
  { address: '0x27f2f159fe990ba83d57f39fd69661764bebf37a', symbol: 'wcUSDCv3', name: 'Wrapped cUSDCv3', decimals: 6 },
  { address: '0xeb74ec1d4c1dab412d5d6674f6833fd19d3118ce', symbol: 'wcUSDTv3', name: 'Wrapped cUSDTv3', decimals: 6 },
  { address: '0x000000dc51b82dc9c14c2c034341c912907d0d59', symbol: 'oBUNNI', name: 'Bunni Call Option Token', decimals: 18 },
  { address: '0x2e4039e8e31475d65dc00293c366fdbfbbc02dc3', symbol: 'PIKU', name: 'Piku Utility Token', decimals: 18 },
];

/** Addresses whose transfers are expected to revert or be restricted. */
export const RESTRICTED_TRANSFERS: ReadonlyMap<string, string> = new Map([
  ['0xf3e621395fc714b90da337aa9108771597b4e696', 'Restricted transfer: rEUL is a reward token that cannot be moved; expect simulation to fail.'],
]);

export const UNVERIFIED_LABEL_WARNING = 'Metadata unverified: showing the contract address instead of a symbol.';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const SYMBOL_STRING_ABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string', name: '' }] },
] as const;
const NAME_STRING_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string', name: '' }] },
] as const;
const SYMBOL_BYTES32_ABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32', name: '' }] },
] as const;
const NAME_BYTES32_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes32', name: '' }] },
] as const;
const DECIMALS_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8', name: '' }] },
] as const;
const BALANCE_OF_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'account' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
] as const;
const ALLOWANCE_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [{ type: 'address', name: 'owner' }, { type: 'address', name: 'spender' }],
    outputs: [{ type: 'uint256', name: '' }],
  },
] as const;

type RawCall = { address: Address; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] };
type RawResult = { status: 'success' | 'failure'; result?: unknown; error?: Error };
type LooseMulticall = (args: {
  contracts: readonly unknown[];
  allowFailure: true;
  blockNumber?: bigint;
}) => Promise<unknown>;

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isFinite(size) || size < 1) throw new Error('chunk size must be a positive integer');
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function shortAddress(address: Address): string {
  return address.slice(0, 6) + '...' + address.slice(-4);
}

/**
 * Cleans a token label coming from a contract (or, defensively, from an indexer).
 * Markup, control characters and stray entities are removed; anything that is
 * still markup-shaped, empty or absurdly long is rejected with null.
 */
export function sanitizeTokenText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutTags = value.replace(/<[^>]*>/g, ' ');
  const withoutEntities = withoutTags.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/gi, ' ');
  const withoutControl = withoutEntities.replace(
    // eslint-disable-next-line no-control-regex -- deliberately strips control and bidi characters from untrusted metadata
    /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g,
    '',
  );
  const cleaned = withoutControl.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (/[<>]/.test(cleaned)) return null;
  if (cleaned.length > 48) return cleaned.slice(0, 48).trim();
  return cleaned;
}

/** Decodes a bytes32 string slot (tokens that return bytes32 from symbol/name). */
export function decodeBytes32Label(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const hex = value.trim();
  if (!/^0x[0-9a-fA-F]*$/.test(hex)) return null;
  let body = hex.slice(2);
  if (body.length > 64) body = body.slice(0, 64);
  if (body.length % 2 !== 0) body = body + '0';
  while (body.length >= 2 && body.slice(-2) === '00') body = body.slice(0, -2);
  if (!body) return null;
  let decoded: string;
  try {
    decoded = hexToString(('0x' + body) as Address);
  } catch {
    return null;
  }
    // eslint-disable-next-line no-control-regex -- NUL padding is not part of a bytes32 label
  return decoded.replace(/\u0000/g, '');
}

type AlchemyPage = { addresses: Address[]; pageKey: string | null };

/**
 * Validates one alchemy_getTokenBalances JSON-RPC payload. Throws on anything
 * that does not match the documented shape; a native-token placeholder or an
 * entry without a usable balance is skipped, never guessed.
 */
export function parseAlchemyBalancesPayload(payload: unknown): AlchemyPage {
  if (!isRecord(payload)) throw new Error('payload was not a JSON object');
  if (payload.error !== undefined && payload.error !== null) {
    const error = payload.error;
    const message = isRecord(error) && typeof error.message === 'string' ? error.message : JSON.stringify(error);
    throw new Error('RPC error: ' + message);
  }
  const result = payload.result;
  if (!isRecord(result)) throw new Error('payload was missing a result object');
  const tokenBalances = result.tokenBalances;
  if (!Array.isArray(tokenBalances)) throw new Error('result.tokenBalances was not an array');
  const addresses: Address[] = [];
  for (const entry of tokenBalances) {
    if (!isRecord(entry)) throw new Error('result.tokenBalances contained a non-object entry');
    const rawAddress = entry.contractAddress;
    if (typeof rawAddress !== 'string') throw new Error('result.tokenBalances entry had no contractAddress string');
    if (!isAddress(rawAddress)) throw new Error('result.tokenBalances entry had an invalid contractAddress');
    const address = getAddress(rawAddress);
    if (address.toLowerCase() === ZERO_ADDRESS) throw new Error('result.tokenBalances entry used the zero address');
    const rawBalance = entry.tokenBalance;
    if (rawBalance !== undefined && rawBalance !== null) {
      if (typeof rawBalance !== 'string' || !/^0x[0-9a-fA-F]*$/.test(rawBalance)) {
        throw new Error('result.tokenBalances entry had a non-hex tokenBalance');
      }
    }
    addresses.push(address);
  }
  const rawPageKey = result.pageKey;
  const pageKey = typeof rawPageKey === 'string' && rawPageKey !== '' ? rawPageKey : null;
  return { addresses, pageKey };
}

type EtherscanPage = { addresses: Address[]; hasMore: boolean };

/** Validates one Etherscan v2 account/tokentx payload and deduplicates nothing. */
export function parseEtherscanTokenTxPayload(payload: unknown, offset: number): EtherscanPage {
  if (!isRecord(payload)) throw new Error('payload was not a JSON object');
  const status = payload.status;
  const message = typeof payload.message === 'string' ? payload.message : '';
  const result = payload.result;
  const resultText = typeof result === 'string' ? result : '';
  if (status === '0' || status === 0) {
    if (/no transactions found/i.test(resultText) || /no transactions found/i.test(message)) {
      return { addresses: [], hasMore: false };
    }
    const detail = resultText !== '' && resultText !== message ? message + ': ' + resultText : message || resultText;
    throw new Error('Etherscan error: ' + (detail || 'unknown error'));
  }
  if (status !== '1' && status !== 1) throw new Error('payload was missing a status field');
  if (!Array.isArray(result)) throw new Error('payload was missing a result array');
  const addresses: Address[] = [];
  for (const entry of result) {
    if (!isRecord(entry)) throw new Error('result contained a non-object entry');
    const rawAddress = entry.contractAddress;
    if (typeof rawAddress !== 'string' || !isAddress(rawAddress)) {
      throw new Error('result entry had an invalid contractAddress');
    }
    const address = getAddress(rawAddress);
    if (address.toLowerCase() === ZERO_ADDRESS) continue;
    addresses.push(address);
  }
  return { addresses, hasMore: result.length >= offset };
}

async function postJson(fetchImpl: typeof fetch, url: string, body: unknown): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  try {
    return await response.json();
  } catch {
    throw new Error('response body was not valid JSON');
  }
}

async function getJson(fetchImpl: typeof fetch, url: string): Promise<unknown> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error('HTTP ' + response.status);
  try {
    return await response.json();
  } catch {
    throw new Error('response body was not valid JSON');
  }
}

type Indexing = { addresses: Address[]; issues: string[]; complete: boolean };

/**
 * Removes provider secrets (API keys) from text that may end up in the DOM.
 * Upstream errors can echo the request URL, which carries the key for Alchemy.
 */
export function redactSecrets(value: string, secrets: readonly string[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret === '') continue;
    redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted;
}

async function indexWithAlchemy(
  fetchImpl: typeof fetch,
  owner: Address,
  alchemyKey: string,
  limits: typeof DISCOVERY_LIMITS,
): Promise<Indexing> {
  const issues: string[] = [];
  const addresses: Address[] = [];
  const seen = new Set<string>();
  const endpoint = 'https://eth-mainnet.g.alchemy.com/v2/' + encodeURIComponent(alchemyKey);
  let pageKey: string | null = null;
  const seenPageKeys = new Set<string>();
  let pages = 0;
  let complete = true;
  for (;;) {
    pages += 1;
    if (pages > limits.alchemyMaxPages) {
      issues.push('Alchemy discovery stopped after ' + limits.alchemyMaxPages + ' pages; the token list may be partial.');
      complete = false;
      break;
    }
    const params: unknown[] = [owner, 'erc20'];
    if (pageKey !== null) params.push({ pageKey });
    let page: AlchemyPage;
    try {
      const payload = await postJson(fetchImpl, endpoint, {
        jsonrpc: '2.0',
        id: 1,
        method: 'alchemy_getTokenBalances',
        params,
      });
      page = parseAlchemyBalancesPayload(payload);
    } catch (error) {
      issues.push('Alchemy token discovery failed on page ' + pages + ': ' + describeError(error) + '.');
      complete = false;
      break;
    }
    let truncated = false;
    for (const address of page.addresses) {
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      if (addresses.length >= limits.alchemyMaxTokens) {
        truncated = true;
        break;
      }
      seen.add(key);
      addresses.push(address);
    }
    if (truncated || (addresses.length >= limits.alchemyMaxTokens && page.pageKey !== null)) {
      issues.push(
        'Alchemy discovery reached the cap of ' + limits.alchemyMaxTokens + ' tokens; the token list may be partial.',
      );
      complete = false;
      break;
    }
    pageKey = page.pageKey;
    if (pageKey === null) break;
    if (seenPageKeys.has(pageKey)) {
      issues.push('Alchemy repeated a page key; stopped paginating to avoid a loop. The token list may be partial.');
      complete = false;
      break;
    }
    seenPageKeys.add(pageKey);
  }
  return { addresses, issues, complete };
}

async function indexWithEtherscan(
  fetchImpl: typeof fetch,
  owner: Address,
  etherscanKey: string,
  limits: typeof DISCOVERY_LIMITS,
): Promise<Indexing> {
  const issues: string[] = [];
  const addresses: Address[] = [];
  const seen = new Set<string>();
  let complete = true;
  let page = 0;
  for (;;) {
    page += 1;
    const url =
      'https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx' +
      '&address=' +
      encodeURIComponent(owner) +
      '&startblock=0&endblock=99999999&sort=asc&page=' +
      page +
      '&offset=' +
      limits.etherscanPageSize +
      '&apikey=' +
      encodeURIComponent(etherscanKey);
    let parsed: EtherscanPage;
    try {
      parsed = parseEtherscanTokenTxPayload(await getJson(fetchImpl, url), limits.etherscanPageSize);
    } catch (error) {
      issues.push('Etherscan token discovery failed on page ' + page + ': ' + describeError(error) + '.');
      complete = false;
      break;
    }
    for (const address of parsed.addresses) {
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      addresses.push(address);
    }
    if (!parsed.hasMore) break;
    if (page >= limits.etherscanMaxPages) {
      issues.push(
        'Etherscan discovery stopped after ' + limits.etherscanMaxPages + ' pages; the token list may be partial.',
      );
      complete = false;
      break;
    }
  }
  return { addresses, issues, complete };
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  return null;
}

function toDecimals(value: unknown): number | null {
  const raw = toBigInt(value);
  if (raw === null || raw > 255n) return null;
  return Number(raw);
}

function getMulticall(client: PublicClient): LooseMulticall {
  const candidate = (client as unknown as { multicall?: unknown }).multicall;
  if (typeof candidate !== 'function') throw new Error('The RPC client does not support batched multicall reads.');
  return candidate as LooseMulticall;
}

function normalizeResult(value: unknown): RawResult {
  if (isRecord(value) && value.status === 'success') return { status: 'success', result: value.result };
  const error = isRecord(value) && value.error ? describeError(value.error) : 'call failed';
  return { status: 'failure', error: new Error(error) };
}

async function callBatch(
  multicall: LooseMulticall,
  calls: readonly RawCall[],
  blockNumber: bigint | undefined,
): Promise<RawResult[] | null> {
  try {
    const outcome = await multicall({
      contracts: calls,
      allowFailure: true,
      ...(blockNumber === undefined ? {} : { blockNumber }),
    });
    if (!Array.isArray(outcome) || outcome.length !== calls.length) return null;
    return outcome.map(normalizeResult);
  } catch {
    return null;
  }
}

async function callOne(
  multicall: LooseMulticall,
  call: RawCall,
  blockNumber: bigint | undefined,
): Promise<RawResult> {
  const batch = await callBatch(multicall, [call], blockNumber);
  if (batch === null || batch.length === 0) return { status: 'failure', error: new Error('call failed') };
  return batch[0];
}

type Balances = { balances: Map<string, bigint>; failures: string[] };

async function readBalances(
  multicall: LooseMulticall,
  owner: Address,
  addresses: readonly Address[],
  blockNumber: bigint | undefined,
  limits: typeof DISCOVERY_LIMITS,
): Promise<Balances> {
  const balances = new Map<string, bigint>();
  const failures: string[] = [];
  for (const group of chunk(addresses, limits.balanceChunkTokens)) {
    const calls: RawCall[] = group.map((address) => ({
      address,
      abi: BALANCE_OF_ABI,
      functionName: 'balanceOf',
      args: [owner],
    }));
    let results = await callBatch(multicall, calls, blockNumber);
    if (results === null) {
      results = [];
      for (const call of calls) results.push(await callOne(multicall, call, blockNumber));
    }
    group.forEach((address, index) => {
      const outcome = results[index];
      const value = outcome && outcome.status === 'success' ? toBigInt(outcome.result) : null;
      if (value === null) failures.push('Balance read failed for ' + address + '.');
      else balances.set(address, value);
    });
  }
  return { balances, failures };
}

type Metadata = { symbol: string | null; name: string | null; decimals: number | null };

async function readBytes32Label(
  multicall: LooseMulticall,
  address: Address,
  field: 'symbol' | 'name',
  blockNumber: bigint | undefined,
): Promise<string | null> {
  const abi = field === 'symbol' ? SYMBOL_BYTES32_ABI : NAME_BYTES32_ABI;
  const outcome = await callOne(multicall, { address, abi, functionName: field }, blockNumber);
  if (outcome.status !== 'success') return null;
  return decodeBytes32Label(outcome.result);
}

async function readMetadata(
  multicall: LooseMulticall,
  addresses: readonly Address[],
  blockNumber: bigint | undefined,
  limits: typeof DISCOVERY_LIMITS,
  issues: string[],
): Promise<{ metadata: Map<string, Metadata>; batchFailures: number }> {
  const metadata = new Map<string, Metadata>();
  let batchFailures = 0;
  for (const group of chunk(addresses, limits.metadataChunkTokens)) {
    const calls: RawCall[] = [];
    for (const address of group) {
      calls.push({ address, abi: SYMBOL_STRING_ABI, functionName: 'symbol' });
      calls.push({ address, abi: NAME_STRING_ABI, functionName: 'name' });
      calls.push({ address, abi: DECIMALS_ABI, functionName: 'decimals' });
    }
    let results = await callBatch(multicall, calls, blockNumber);
    if (results === null) {
      batchFailures += 1;
      issues.push('Batched metadata read failed for ' + group.length + ' token(s); retried the batch one call at a time.');
      results = [];
      for (const call of calls) results.push(await callOne(multicall, call, blockNumber));
    }
    for (let index = 0; index < group.length; index += 1) {
      const address = group[index];
      const base = index * 3;
      const symbolOutcome = results[base];
      const nameOutcome = results[base + 1];
      const decimalsOutcome = results[base + 2];
      let symbol =
        symbolOutcome && symbolOutcome.status === 'success' ? sanitizeTokenText(symbolOutcome.result) : null;
      let name = nameOutcome && nameOutcome.status === 'success' ? sanitizeTokenText(nameOutcome.result) : null;
      if (symbol === null) symbol = sanitizeTokenText(await readBytes32Label(multicall, address, 'symbol', blockNumber));
      if (name === null) name = sanitizeTokenText(await readBytes32Label(multicall, address, 'name', blockNumber));
      const decimals =
        decimalsOutcome && decimalsOutcome.status === 'success' ? toDecimals(decimalsOutcome.result) : null;
      metadata.set(address.toLowerCase(), { symbol, name, decimals });
    }
  }
  return { metadata, batchFailures };
}

async function readAllowances(
  multicall: LooseMulticall,
  owner: Address,
  spender: Address,
  addresses: readonly Address[],
  blockNumber: bigint | undefined,
  limits: typeof DISCOVERY_LIMITS,
  issues: string[],
): Promise<{ allowances: Map<string, bigint>; failures: number }> {
  const allowances = new Map<string, bigint>();
  let failures = 0;
  for (const group of chunk(addresses, limits.allowanceChunkTokens)) {
    const calls: RawCall[] = group.map((address) => ({
      address,
      abi: ALLOWANCE_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    }));
    let results = await callBatch(multicall, calls, blockNumber);
    if (results === null) {
      results = [];
      for (const call of calls) results.push(await callOne(multicall, call, blockNumber));
    }
    group.forEach((address, index) => {
      const outcome = results[index];
      const value = outcome && outcome.status === 'success' ? toBigInt(outcome.result) : null;
      if (value === null) issues.push('Allowance read failed for ' + address + '; treated as unknown.');
      else allowances.set(address, value);
      if (value === null) failures += 1;
    });
  }
  return { allowances, failures };
}

function buildWarning(addressKey: string, labelFromAddress: boolean): string | null {
  const warnings: string[] = [];
  const restricted = RESTRICTED_TRANSFERS.get(addressKey);
  if (restricted) warnings.push(restricted);
  if (labelFromAddress) warnings.push(UNVERIFIED_LABEL_WARNING);
  return warnings.length > 0 ? warnings.join(' ') : null;
}

async function collectCandidates(
  options: DiscoveryOptions,
  indexed: Address[],
  issues: string[],
): Promise<Array<{ address: Address; source: Token['source'] }>> {
  const rank: Record<Token['source'], number> = { known: 0, manual: 1, indexed: 2 };
  const candidates = new Map<string, { address: Address; source: Token['source'] }>();
  const add = (address: Address, source: Token['source']) => {
    const key = address.toLowerCase();
    const existing = candidates.get(key);
    if (existing && rank[existing.source] >= rank[source]) return;
    candidates.set(key, { address, source });
  };
  for (const entry of KNOWN_TOKENS) add(getAddress(entry.address), 'known');
  const manual = Array.isArray(options.manualAddresses) ? options.manualAddresses : [];
  for (const entry of manual) {
    if (typeof entry !== 'string' || !isAddress(entry)) {
      issues.push('Ignored manual token address ' + String(entry) + ': not a valid address.');
      continue;
    }
    const address = getAddress(entry);
    if (address.toLowerCase() === ZERO_ADDRESS) {
      issues.push('Ignored manual token address 0x0000000000000000000000000000000000000000: the zero address is not a token.');
      continue;
    }
    add(address, 'manual');
  }
  for (const address of indexed) add(address, 'indexed');
  return [...candidates.values()];
}

/**
 * Discovers the ERC-20 holdings of 'owner'. Never throws for upstream problems:
 * they are reported through 'issues' and 'complete'.
 */
export async function discoverTokens(
  client: PublicClient,
  owner: Address,
  options: DiscoveryOptions,
  deps: DiscoveryDeps = {},
): Promise<DiscoveryResult> {
  const issues: string[] = [];
  const fetchImpl = deps.fetch ?? (typeof fetch === 'function' ? fetch : undefined);
  const alchemyKey = typeof options.alchemyKey === 'string' ? options.alchemyKey.trim() : '';
  const etherscanKey = typeof options.etherscanKey === 'string' ? options.etherscanKey.trim() : '';
  const useAlchemy = alchemyKey !== '';
  const useEtherscan = !useAlchemy && etherscanKey !== '';

  let indexing: { addresses: Address[]; complete: boolean };
  if (useAlchemy || useEtherscan) {
    if (!fetchImpl) {
      issues.push('Token indexing is unavailable: no fetch implementation is present in this environment.');
      indexing = { addresses: [], complete: false };
    } else if (useAlchemy) {
      const result = await indexWithAlchemy(fetchImpl, getAddress(owner), alchemyKey, DISCOVERY_LIMITS);
      issues.push(...result.issues.map((issue) => redactSecrets(issue, [alchemyKey, etherscanKey])));
      indexing = { addresses: result.addresses, complete: result.complete };
    } else {
      const result = await indexWithEtherscan(fetchImpl, getAddress(owner), etherscanKey, DISCOVERY_LIMITS);
      issues.push(...result.issues.map((issue) => redactSecrets(issue, [alchemyKey, etherscanKey])));
      indexing = { addresses: result.addresses, complete: result.complete };
    }
  } else {
    issues.push(NO_INDEXER_ISSUE);
    indexing = { addresses: [], complete: false };
  }
  let complete = indexing.complete;

  const candidates = await collectCandidates(options, indexing.addresses, issues);
  if (candidates.length === 0) {
    return { tokens: [], issues: [...new Set(issues)], complete };
  }

  const multicall = getMulticall(client);
  let blockNumber: bigint | undefined;
  try {
    blockNumber = await client.getBlockNumber();
  } catch (error) {
    issues.push('Could not pin a block for balance reads: ' + describeError(error) + '.');
    complete = false;
  }

  const { balances, failures } = await readBalances(multicall, getAddress(owner), candidates.map((c) => c.address), blockNumber, DISCOVERY_LIMITS);
  issues.push(...failures);
  if (failures.length > 0) complete = false;
  if (balances.size === 0) {
    issues.push('Every balance read failed; the discovered token list is not trustworthy.');
    complete = false;
  }

  const held = candidates.filter((candidate) => {
    const balance = balances.get(candidate.address);
    return balance !== undefined && balance !== 0n;
  });

  const metadataRead = await readMetadata(multicall, held.map((c) => c.address), blockNumber, DISCOVERY_LIMITS, issues);
  const metadata = metadataRead.metadata;
  if (metadataRead.batchFailures > 0) complete = false;

  const curated = new Map<string, KnownToken>();
  for (const entry of KNOWN_TOKENS) curated.set(entry.address.toLowerCase(), entry);

  const spender = options.spender === null || options.spender === undefined ? null : isAddress(options.spender) ? getAddress(options.spender) : null;
  if (options.spender !== null && options.spender !== undefined && spender === null) {
    issues.push('Ignored the configured spender address: not a valid address. Allowances cannot be shown.');
  }
  const allowanceRead =
    spender === null
      ? { allowances: new Map<string, bigint>(), failures: 0 }
      : await readAllowances(
          multicall,
          getAddress(owner),
          spender,
          held.map((c) => c.address),
          blockNumber,
          DISCOVERY_LIMITS,
          issues,
        );
  const allowances = allowanceRead.allowances;
  if (allowanceRead.failures > 0) complete = false;

  const tokens: Token[] = [];
  for (const candidate of held) {
    const key = candidate.address.toLowerCase();
    const balance = balances.get(candidate.address);
    if (balance === undefined) continue;
    const meta = metadata.get(key);
    const entry = curated.get(key);
    const decimals = meta?.decimals ?? entry?.decimals ?? null;
    if (decimals === null) {
      issues.push('Excluded ' + candidate.address + ': decimals() could not be read.');
      complete = false;
      continue;
    }
    if (meta && meta.decimals === null && entry) {
      issues.push('Used curated decimals for ' + candidate.address + ' because decimals() could not be read.');
    }
    const symbol = meta?.symbol ?? entry?.symbol ?? null;
    const name = meta?.name ?? entry?.name ?? symbol;
    const labelFromAddress = symbol === null;
    tokens.push({
      address: candidate.address,
      symbol: symbol ?? shortAddress(candidate.address),
      name: name ?? shortAddress(candidate.address),
      decimals,
      balance,
      allowance: spender === null ? null : allowances.get(candidate.address) ?? null,
      warning: buildWarning(key, labelFromAddress),
      source: candidate.source,
    });
  }

  tokens.sort((left, right) => {
    if (left.balance !== right.balance) return left.balance > right.balance ? -1 : 1;
    const bySymbol = left.symbol.toLowerCase().localeCompare(right.symbol.toLowerCase());
    if (bySymbol !== 0) return bySymbol;
    return left.address.toLowerCase().localeCompare(right.address.toLowerCase());
  });

  return { tokens, issues: [...new Set(issues)], complete };
}
