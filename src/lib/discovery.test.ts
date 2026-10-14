import { describe, expect, test } from 'bun:test';
import { getAddress, type Address, type PublicClient } from 'viem';
import {
  DISCOVERY_LIMITS,
  KNOWN_TOKENS,
  NO_INDEXER_ISSUE,
  UNVERIFIED_LABEL_WARNING,
  chunk,
  decodeBytes32Label,
  discoverTokens,
  parseAlchemyBalancesPayload,
  parseEtherscanTokenTxPayload,
  redactSecrets,
  sanitizeTokenText,
  type DiscoveryOptions,
  type Token,
} from './discovery';

const OWNER = '0x1111111111111111111111111111111111111111' as Address;
const SPENDER = '0x2222222222222222222222222222222222222222' as Address;
const REUL = '0xf3e621395fc714b90da337aa9108771597b4e696';
const CVX = '0x4e3fbd56cd56c3e72c1403e103b45db9da5b9d2b';

const options = (over: Partial<DiscoveryOptions> = {}): DiscoveryOptions => ({
  alchemyKey: '',
  etherscanKey: '',
  spender: null,
  manualAddresses: [],
  ...over,
});

/** Deterministic, non-catalogue mainnet-shaped address (avoids the curated list). */
const toAddress = (n: number): Address => ('0x' + n.toString(16).padStart(40, '0')) as Address;
const key = (address: string) => address.toLowerCase();
const bytes32 = (value: string) => '0x' + Buffer.from(value, 'utf8').toString('hex').padEnd(64, '0');

type Spec = {
  symbol?: unknown;
  name?: unknown;
  decimals?: unknown;
  balance?: unknown;
  allowance?: unknown;
};

type MockClient = {
  client: PublicClient;
  calls: string[];
  blocks: Array<bigint | undefined>;
  batches: number[];
};

function mockClient(
  specs: Record<string, Spec>,
  opts: { blockNumber?: bigint; failBlockNumber?: boolean; failBulk?: boolean; withoutCatalogue?: boolean } = {},
): MockClient {
  const resolved: Record<string, Spec> = opts.withoutCatalogue ? specs : { ...catalogueSpecs(), ...specs };
  const calls: string[] = [];
  const blocks: Array<bigint | undefined> = [];
  const batches: number[] = [];
  const text = (value: unknown, isBytes32: boolean) => {
    if (typeof value === 'string') {
      return isBytes32 ? { status: 'failure', error: new Error('string ABI cannot decode bytes32') } : { status: 'success', result: value };
    }
    if (typeof value === 'object' && value !== null && typeof (value as { bytes32?: unknown }).bytes32 === 'string') {
      const raw = (value as { bytes32: string }).bytes32;
      return isBytes32 ? { status: 'success', result: raw } : { status: 'failure', error: new Error('bytes32 ABI cannot decode string') };
    }
    return { status: 'failure', error: new Error('call reverted') };
  };
  const numeric = (value: unknown) =>
    typeof value === 'bigint' || typeof value === 'number'
      ? { status: 'success', result: value }
      : { status: 'failure', error: new Error('call reverted') };
  const resolve = (call: { address: string; abi: readonly unknown[]; functionName: string }) => {
    const spec = resolved[key(call.address)];
    const isBytes32 = (call.abi[0] as { outputs: Array<{ type: string }> }).outputs[0].type === 'bytes32';
    calls.push(call.functionName);
    if (!spec) return { status: 'failure', error: new Error('no contract at address') };
    if (call.functionName === 'symbol') return text(spec.symbol, isBytes32);
    if (call.functionName === 'name') return text(spec.name, isBytes32);
    if (call.functionName === 'decimals') return numeric(spec.decimals);
    if (call.functionName === 'balanceOf') return numeric(spec.balance);
    if (call.functionName === 'allowance') return numeric(spec.allowance);
    return { status: 'failure', error: new Error('unsupported call') };
  };
  const client = {
    getBlockNumber: async () => {
      if (opts.failBlockNumber) throw new Error('node unreachable');
      return opts.blockNumber ?? 21_000_000n;
    },
    multicall: async (args: { contracts: Array<{ address: string; abi: readonly unknown[]; functionName: string }>; blockNumber?: bigint }) => {
      blocks.push(args.blockNumber);
      batches.push(args.contracts.length);
      if (opts.failBulk && args.contracts.length > 1) throw new Error('bulk decode failure');
      return args.contracts.map(resolve);
    },
  };
  return { client: client as unknown as PublicClient, calls, blocks, batches };
}

type Route = { ok?: boolean; status?: number; body?: unknown; throws?: Error };

function jsonFetch(plan: (url: string, body: unknown) => Route): typeof fetch {
  const fn = async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    const route = plan(url, body);
    if (route.throws) throw route.throws;
    if (route.ok === false) {
      return { ok: false, status: route.status ?? 500, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => route.body } as unknown as Response;
  };
  return fn as unknown as typeof fetch;
}

const alchemyPage = (addresses: Address[], pageKey?: string) => ({
  jsonrpc: '2.0',
  id: 1,
  result: {
    address: OWNER,
    tokenBalances: addresses.map((address) => ({ contractAddress: address, tokenBalance: '0x1' })),
    ...(pageKey === undefined ? {} : { pageKey }),
  },
});

const etherscanPage = (addresses: Address[]) => ({
  status: '1',
  message: 'OK',
  result: addresses.map((address) => ({ contractAddress: address, hash: '0x0', tokenSymbol: '<b>IGNORED</b>' })),
});

/** Catalogue entries with zero balances unless overridden. */
function catalogueSpecs(overrides: Record<string, Spec> = {}): Record<string, Spec> {
  const specs: Record<string, Spec> = {};
  for (const entry of KNOWN_TOKENS) {
    specs[key(entry.address)] = {
      symbol: entry.symbol,
      name: entry.name,
      decimals: entry.decimals,
      balance: 0n,
      allowance: 0n,
    };
  }
  for (const [address, over] of Object.entries(overrides)) {
    specs[key(address)] = { ...specs[key(address)], ...over };
  }
  return specs;
}

function fillerSpecs(start: number, count: number, balance: bigint = 0n): Record<string, Spec> {
  const specs: Record<string, Spec> = {};
  for (let index = 0; index < count; index += 1) {
    const n = start + index;
    specs[key(toAddress(n))] = { symbol: 'T' + n, name: 'Token ' + n, decimals: 18, balance, allowance: 0n };
  }
  return specs;
}

const bySymbol = (tokens: Token[], symbol: string) => tokens.find((token) => token.symbol === symbol);

describe('known catalogue fallback', () => {
  test('returns catalogue plus manual entries and reports the missing indexer', async () => {
    const manual = toAddress(9001);
    const specs = catalogueSpecs({
      [CVX]: { balance: 1n },
      [manual]: { symbol: 'MANUAL', name: 'Manual Token', decimals: 8, balance: 250n },
    });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ manualAddresses: [manual] }));
    expect(result.complete).toBe(false);
    expect(result.issues).toContain(NO_INDEXER_ISSUE);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['MANUAL', 'CVX']);
    expect(bySymbol(result.tokens, 'CVX')?.balance).toBe(1n);
    expect(bySymbol(result.tokens, 'CVX')?.source).toBe('known');
    expect(bySymbol(result.tokens, 'MANUAL')?.source).toBe('manual');
    expect(result.tokens.every((token) => token.allowance === null)).toBe(true);
    expect(result.tokens.every((token) => token.warning === null)).toBe(true);
  });

  test('rejects malformed manual addresses without failing discovery', async () => {
    const { client } = mockClient(catalogueSpecs({ [CVX]: { balance: 5n } }));
    const result = await discoverTokens(client, OWNER, options({
      manualAddresses: ['not-an-address' as Address, '0x0000000000000000000000000000000000000000' as Address],
    }));
    expect(result.tokens).toHaveLength(1);
    expect(result.issues.some((issue) => issue.includes('Ignored manual token address'))).toBe(true);
  });

  test('flags restricted transfers and sorts by balance', async () => {
    const { client } = mockClient(catalogueSpecs({ [REUL]: { balance: 42n }, [CVX]: { balance: 7n } }));
    const result = await discoverTokens(client, OWNER, options());
    expect(result.tokens.map((token) => token.symbol)).toEqual(['rEUL', 'CVX']);
    expect(bySymbol(result.tokens, 'rEUL')?.warning).toContain('Restricted transfer');
    expect(bySymbol(result.tokens, 'rEUL')?.decimals).toBe(18);
  });

  test('reads allowances only when a spender is configured', async () => {
    const { client, calls } = mockClient(catalogueSpecs({ [CVX]: { balance: 5n, allowance: 9n } }));
    const withoutSpender = await discoverTokens(client, OWNER, options());
    expect(withoutSpender.tokens[0].allowance).toBeNull();
    expect(calls).not.toContain('allowance');

    const withSpender = await discoverTokens(client, OWNER, options({ spender: SPENDER }));
    expect(withSpender.tokens[0].allowance).toBe(9n);
  });
});

describe('alchemy discovery', () => {
  test('paginates every page, merges manual addresses and pins one block', async () => {
    const [a, b, c, d] = [toAddress(101), toAddress(102), toAddress(103), toAddress(104)];
    const specs = {
      [key(a)]: { symbol: 'AA', name: 'Token AA', decimals: 18, balance: 10n, allowance: 0n },
      [key(b)]: { symbol: 'BB', name: 'Token BB', decimals: 6, balance: 5n, allowance: 0n },
      [key(c)]: { symbol: 'CC', name: 'Token CC', decimals: 18, balance: 5n, allowance: 0n },
      [key(d)]: { symbol: 'MAN', name: 'Manual', decimals: 2, balance: 3n, allowance: 0n },
    };
    const requested: Array<string | undefined> = [];
    const fetchImpl = jsonFetch((_url, body) => {
      const params = (body as { params: unknown[] }).params;
      const pageKey = (params[2] as { pageKey?: string } | undefined)?.pageKey;
      requested.push(pageKey);
      return pageKey === undefined
        ? { body: alchemyPage([a, b], 'page-2') }
        : { body: alchemyPage([b, c]) };
    });
    const { client, blocks } = mockClient(specs, { blockNumber: 777n });
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY', manualAddresses: [d] }), { fetch: fetchImpl });

    expect(requested).toEqual([undefined, 'page-2']);
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['AA', 'BB', 'CC', 'MAN']);
    expect(bySymbol(result.tokens, 'BB')?.source).toBe('indexed');
    expect(bySymbol(result.tokens, 'MAN')?.source).toBe('manual');
    expect(blocks.every((block) => block === 777n)).toBe(true);
  });

  test('keeps page one tokens but reports incomplete on a malformed page', async () => {
    const [a, b] = [toAddress(201), toAddress(202)];
    const specs = {
      [key(a)]: { symbol: 'AA', name: 'Token AA', decimals: 18, balance: 4n, allowance: 0n },
      [key(b)]: { symbol: 'BB', name: 'Token BB', decimals: 18, balance: 4n, allowance: 0n },
    };
    let call = 0;
    const fetchImpl = jsonFetch(() => {
      call += 1;
      return call === 1
        ? { body: alchemyPage([a], 'page-2') }
        : { body: { jsonrpc: '2.0', id: 1, result: { tokenBalances: 'definitely-not-an-array' } } };
    });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.includes('Alchemy token discovery failed on page 2'))).toBe(true);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['AA']);
  });

  test('stops when alchemy repeats a page key', async () => {
    const [a, b] = [toAddress(301), toAddress(302)];
    const specs = {
      [key(a)]: { symbol: 'AA', name: 'Token AA', decimals: 18, balance: 2n, allowance: 0n },
      [key(b)]: { symbol: 'BB', name: 'Token BB', decimals: 18, balance: 2n, allowance: 0n },
    };
    let call = 0;
    const fetchImpl = jsonFetch(() => {
      call += 1;
      return { body: call === 1 ? alchemyPage([a], 'same') : alchemyPage([b], 'same') };
    });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    expect(call).toBe(2);
    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.includes('repeated a page key'))).toBe(true);
    expect(result.tokens).toHaveLength(2);
  });

  test('stops at the token cap and reports partial enumeration', async () => {
    const specs = fillerSpecs(100_000, DISCOVERY_LIMITS.alchemyMaxTokens, 2n);
    const fetchImpl = jsonFetch((_url, body) => {
      const params = (body as { params: unknown[] }).params;
      const pageKey = (params[2] as { pageKey?: string } | undefined)?.pageKey;
      const page = pageKey === undefined ? 0 : Number(pageKey.replace('k', ''));
      const addresses = Array.from({ length: 1000 }, (_, index) => toAddress(100_000 + page * 1000 + index));
      return { body: alchemyPage(addresses, 'k' + (page + 1)) };
    });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.includes(String(DISCOVERY_LIMITS.alchemyMaxTokens)))).toBe(true);
    expect(result.tokens).toHaveLength(DISCOVERY_LIMITS.alchemyMaxTokens);
  });

  test('redacts the api key when an upstream error echoes the url', async () => {
    const fetchImpl = jsonFetch(() => ({
      throws: new Error('connect ECONNREFUSED https://eth-mainnet.g.alchemy.com/v2/SUPER-SECRET-KEY'),
    }));
    const { client } = mockClient(catalogueSpecs({ [CVX]: { balance: 1n } }));
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'SUPER-SECRET-KEY' }), { fetch: fetchImpl });

    expect(result.issues.some((issue) => issue.includes('[redacted]'))).toBe(true);
    expect(result.issues.some((issue) => issue.includes('SUPER-SECRET-KEY'))).toBe(false);
    expect(result.complete).toBe(false);
  });

  test('handles a non-2xx response without throwing', async () => {
    const fetchImpl = jsonFetch(() => ({ ok: false, status: 429 }));
    const { client } = mockClient(catalogueSpecs({ [CVX]: { balance: 1n } }));
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });
    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.includes('HTTP 429'))).toBe(true);
  });
});

describe('etherscan discovery', () => {
  test('paginates 1000-entry pages, deduplicates and stops on a short page', async () => {
    const page1 = [...Array.from({ length: 998 }, (_, index) => toAddress(1000 + index)), toAddress(1000), toAddress(1001)];
    const page2 = [toAddress(2000), toAddress(2001)];
    const specs = { ...fillerSpecs(1000, 998), [key(toAddress(2000))]: { symbol: 'LAST', name: 'Last', decimals: 18, balance: 7n, allowance: 0n } };
    specs[key(toAddress(1000))] = { symbol: 'DUST', name: 'Dust', decimals: 18, balance: 1n, allowance: 0n };
    specs[key(toAddress(2001))] = { symbol: 'ZERO', name: 'Zero', decimals: 18, balance: 0n, allowance: 0n };
    const pages: number[] = [];
    const offsets: number[] = [];
    const fetchImpl = jsonFetch((url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      const offset = Number(new URL(url).searchParams.get('offset'));
      offsets.push(offset);
      pages.push(page);
      return { body: page === 1 ? etherscanPage(page1) : etherscanPage(page2) };
    });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ etherscanKey: 'KEY' }), { fetch: fetchImpl });

    expect(pages).toEqual([1, 2]);
    expect(offsets).toEqual([DISCOVERY_LIMITS.etherscanPageSize, DISCOVERY_LIMITS.etherscanPageSize]);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['LAST', 'DUST']);
    expect(result.tokens.every((token) => token.source === 'indexed')).toBe(true);
    expect(result.complete).toBe(true);
  });

  test('reports incomplete when the page cap is reached', async () => {
    const page = Array.from({ length: 1000 }, (_, index) => toAddress(5000 + index));
    const specs = fillerSpecs(5000, 1000, 0n);
    specs[key(toAddress(5000))] = { symbol: 'HELD', name: 'Held', decimals: 18, balance: 3n, allowance: 0n };
    let fetches = 0;
    const fetchImpl = jsonFetch(() => {
      fetches += 1;
      return { body: etherscanPage(page) };
    });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ etherscanKey: 'KEY' }), { fetch: fetchImpl });

    expect(fetches).toBe(DISCOVERY_LIMITS.etherscanMaxPages);
    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.includes('stopped after ' + DISCOVERY_LIMITS.etherscanMaxPages + ' pages'))).toBe(true);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['HELD']);
  });

  test('treats an empty account as a complete scan', async () => {
    const fetchImpl = jsonFetch(() => ({ body: { status: '0', message: 'No Result', result: 'No transactions found' } }));
    const { client } = mockClient(catalogueSpecs({ [CVX]: { balance: 2n } }));
    const result = await discoverTokens(client, OWNER, options({ etherscanKey: 'KEY' }), { fetch: fetchImpl });
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['CVX']);
  });

  test('reports an upstream error status', async () => {
    const fetchImpl = jsonFetch(() => ({ body: { status: '0', message: 'NOTOK', result: 'Invalid API Key' } }));
    const { client } = mockClient(catalogueSpecs({ [CVX]: { balance: 2n } }));
    const result = await discoverTokens(client, OWNER, options({ etherscanKey: 'KEY' }), { fetch: fetchImpl });
    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.includes('Etherscan token discovery failed on page 1'))).toBe(true);
  });

  test('alchemy wins when both keys are present', async () => {
    const a = toAddress(4001);
    const specs = { [key(a)]: { symbol: 'ALC', name: 'Alchemy Token', decimals: 18, balance: 6n, allowance: 0n } };
    const seen: string[] = [];
    const fetchImpl = jsonFetch((url) => {
      seen.push(url);
      return { body: alchemyPage([a]) };
    });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY', etherscanKey: 'KEY2' }), { fetch: fetchImpl });
    expect(seen.every((url) => url.includes('alchemy.com'))).toBe(true);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['ALC']);
  });
});

describe('on-chain read failures', () => {
  test('excludes a token whose balance cannot be read and stays incomplete', async () => {
    const [a, b] = [toAddress(501), toAddress(502)];
    const specs = { [key(a)]: { symbol: 'AA', name: 'Token AA', decimals: 18, balance: 4n, allowance: 0n } };
    const fetchImpl = jsonFetch(() => ({ body: alchemyPage([a, b]) }));
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    expect(result.tokens.map((token) => token.symbol)).toEqual(['AA']);
    expect(result.issues.some((issue) => issue.includes('Balance read failed for ' + b))).toBe(true);
    expect(result.complete).toBe(false);
  });

  test('excludes a token whose decimals cannot be read and stays incomplete', async () => {
    const a = toAddress(601);
    const specs = { [key(a)]: { symbol: 'AA', name: 'Token AA', balance: 4n, allowance: 0n } };
    const fetchImpl = jsonFetch(() => ({ body: alchemyPage([a]) }));
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    expect(result.tokens).toHaveLength(0);
    expect(result.issues.some((issue) => issue.includes('decimals() could not be read'))).toBe(true);
    expect(result.complete).toBe(false);
  });

  test('marks an unreadable decimals value on a curated token as incomplete', async () => {
    const specs = catalogueSpecs({ [CVX]: { balance: 3n, decimals: null } });
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ manualAddresses: [] }));
    expect(bySymbol(result.tokens, 'CVX')?.decimals).toBe(18);
    expect(result.issues.some((issue) => issue.includes('Used curated decimals'))).toBe(true);
    expect(result.complete).toBe(false);
  });

  test('reports a failed allowance read and stays incomplete', async () => {
    const a = toAddress(701);
    const specs = { [key(a)]: { symbol: 'AA', name: 'Token AA', decimals: 18, balance: 4n } };
    const fetchImpl = jsonFetch(() => ({ body: alchemyPage([a]) }));
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY', spender: SPENDER }), { fetch: fetchImpl });

    expect(result.tokens[0].allowance).toBeNull();
    expect(result.issues.some((issue) => issue.includes('Allowance read failed'))).toBe(true);
    expect(result.complete).toBe(false);
  });

  test('survives a broken bulk multicall by retrying single calls', async () => {
    const a = toAddress(801);
    const specs = { [key(a)]: { symbol: 'AA', name: 'Token AA', decimals: 18, balance: 4n, allowance: 0n } };
    const fetchImpl = jsonFetch(() => ({ body: alchemyPage([a]) }));
    const { client } = mockClient(specs, { failBulk: true });
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    expect(result.tokens.map((token) => token.symbol)).toEqual(['AA']);
    expect(result.issues.some((issue) => issue.includes('Batched metadata read failed'))).toBe(true);
    expect(result.complete).toBe(false);
  });

  test('falls back to hex labels and marks the metadata unverified', async () => {
    const [a, b] = [toAddress(901), toAddress(902)];
    const specs = {
      [key(a)]: { symbol: { bytes32: bytes32('MKR32') }, name: { bytes32: bytes32('Maker DAO') }, decimals: 18, balance: 2n, allowance: 0n },
      [key(b)]: { symbol: '<b>', name: '<i></i>', decimals: 18, balance: 1n, allowance: 0n },
    };
    const fetchImpl = jsonFetch(() => ({ body: alchemyPage([a, b]) }));
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    const decoded = bySymbol(result.tokens, 'MKR32');
    expect(decoded?.name).toBe('Maker DAO');
    expect(decoded?.warning).toBeNull();
    const labelled = result.tokens.find((token) => token.symbol.startsWith('0x'));
    expect(labelled?.symbol).toBe(b.slice(0, 6) + '...' + b.slice(-4));
    expect(labelled?.warning).toContain(UNVERIFIED_LABEL_WARNING);
  });

  test('sanitizes markup returned as a string label', async () => {
    const a = toAddress(1001);
    const specs = {
      [key(a)]: { symbol: '<b>USDC</b>', name: 'E<b>V</b>IL', decimals: 6, balance: 9n, allowance: 0n },
    };
    const fetchImpl = jsonFetch(() => ({ body: alchemyPage([a]) }));
    const { client } = mockClient(specs);
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });
    expect(result.tokens[0].symbol).toBe('USDC');
    expect(result.tokens[0].name).toBe('E V IL');
  });

  test('reports an unpinnable block without dropping readable balances', async () => {
    const a = toAddress(1101);
    const specs = { [key(a)]: { symbol: 'AA', name: 'Token AA', decimals: 18, balance: 4n, allowance: 0n } };
    const fetchImpl = jsonFetch(() => ({ body: alchemyPage([a]) }));
    const { client, blocks } = mockClient(specs, { failBlockNumber: true });
    const result = await discoverTokens(client, OWNER, options({ alchemyKey: 'KEY' }), { fetch: fetchImpl });

    expect(result.complete).toBe(false);
    expect(result.issues.some((issue) => issue.includes('Could not pin a block'))).toBe(true);
    expect(blocks.every((block) => block === undefined)).toBe(true);
    expect(result.tokens.map((token) => token.symbol)).toEqual(['AA']);
  });
});

describe('upstream payload validation', () => {
  test('alchemy payloads are validated field by field', () => {
    const address = toAddress(2001);
    const parsed = parseAlchemyBalancesPayload(alchemyPage([address], 'next'));
    expect(parsed.addresses).toEqual([getAddress(address)]);
    expect(parsed.pageKey).toBe('next');
    expect(() => parseAlchemyBalancesPayload(null)).toThrow();
    expect(() => parseAlchemyBalancesPayload({ result: { tokenBalances: 'nope' } })).toThrow();
    expect(() => parseAlchemyBalancesPayload({ result: { tokenBalances: [{ contractAddress: '0x123' }] } })).toThrow();
    expect(() => parseAlchemyBalancesPayload({ result: { tokenBalances: [{ contractAddress: address, tokenBalance: 'nope' }] } })).toThrow();
    expect(() => parseAlchemyBalancesPayload({ error: { message: 'rate limited' } })).toThrow('rate limited');
  });

  test('etherscan payloads are validated and short pages close the scan', () => {
    const parsed = parseEtherscanTokenTxPayload(etherscanPage([toAddress(3001)]), 1000);
    expect(parsed.hasMore).toBe(false);
    const full = parseEtherscanTokenTxPayload(
      etherscanPage(Array.from({ length: 1000 }, (_, index) => toAddress(3000 + index))),
      1000,
    );
    expect(full.hasMore).toBe(true);
    expect(() => parseEtherscanTokenTxPayload({ status: '0', message: 'NOTOK', result: 'boom' }, 1000)).toThrow('boom');
    expect(() => parseEtherscanTokenTxPayload({ status: '1', result: [{ contractAddress: 'nope' }] }, 1000)).toThrow();
    expect(() => parseEtherscanTokenTxPayload('not json', 1000)).toThrow();
  });
});

describe('helpers', () => {
  test('sanitizeTokenText removes markup, entities and control characters', () => {
    expect(sanitizeTokenText('<b>USDC</b>')).toBe('USDC');
    expect(sanitizeTokenText('  spaced\u0000out  ')).toBe('spacedout');
    expect(sanitizeTokenText('A &amp; B')).toBe('A B');
    expect(sanitizeTokenText('<script')).toBeNull();
    expect(sanitizeTokenText('<b></b>')).toBeNull();
    expect(sanitizeTokenText('')).toBeNull();
    expect(sanitizeTokenText(undefined)).toBeNull();
    expect(sanitizeTokenText('x'.repeat(80))?.length).toBe(48);
  });

  test('decodeBytes32Label decodes padded values and rejects junk', () => {
    expect(decodeBytes32Label(bytes32('WETH'))).toBe('WETH');
    expect(decodeBytes32Label('0x' + '00'.repeat(32))).toBeNull();
    expect(decodeBytes32Label('not-hex')).toBeNull();
    expect(decodeBytes32Label(1234)).toBeNull();
  });

  test('redactSecrets removes keys and ignores blanks', () => {
    expect(redactSecrets('url with KEY123 inside', ['KEY123', ''])).toBe('url with [redacted] inside');
    expect(redactSecrets('nothing to hide', [])).toBe('nothing to hide');
  });

  test('chunk splits into bounded groups', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow();
  });

  test('catalogue entries are checksummable, unique and priced-token free', () => {
    const addresses = KNOWN_TOKENS.map((entry) => entry.address.toLowerCase());
    expect(new Set(addresses).size).toBe(KNOWN_TOKENS.length);
    expect(KNOWN_TOKENS.every((entry) => /^0x[0-9a-f]{40}$/.test(entry.address))).toBe(true);
    expect(KNOWN_TOKENS.every((entry) => Number.isInteger(entry.decimals) && entry.decimals >= 0 && entry.decimals <= 36)).toBe(true);
  });
});
