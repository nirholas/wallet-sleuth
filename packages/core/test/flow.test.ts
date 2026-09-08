import { describe, expect, it } from 'vitest';
import { buildFlow, DEFAULT_FLOW_OPTIONS } from '../src/flow.js';
import { EMPTY_NAMES } from '../src/names.js';
import { formatUsd, priceKey } from '../src/prices.js';
import { bundle, transfer, A, B, EXCHANGE, FUNDER } from './fixtures.js';
import type { PriceBook } from '../src/prices.js';
import type { Transfer } from '../src/types.js';

/** A price book that values native units at $2 and knows nothing else, so both paths are exercised. */
const prices: PriceBook = {
  get: () => undefined,
  usd: (t: Transfer) => (t.asset.kind === 'native' ? t.value * 2 : undefined),
  unpriced: ['ethereum:unknownmint'],
  resolved: 1,
};

describe('flow graph', () => {
  it('aggregates transfers between the same pair into one directed edge', () => {
    const bundles = [
      bundle(A, [
        transfer({ from: A, to: B, value: 3 }),
        transfer({ from: A, to: B, value: 2 }),
      ]),
      bundle(B, []),
    ];
    const flow = buildFlow(bundles, [], prices, EMPTY_NAMES, undefined);
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0]!.transfers).toBe(2);
    expect(flow.edges[0]!.usd).toBe(10);
    expect(flow.totalUsd).toBe(10);
  });

  it('keeps direction, so a payment out is never confused with a payment in', () => {
    const bundles = [bundle(A, [transfer({ from: A, to: B, value: 1 })]), bundle(B, [])];
    const flow = buildFlow(bundles, [], prices, EMPTY_NAMES, undefined);
    const edge = flow.edges[0]!;
    expect(edge.source).toContain(A.toLowerCase());
    expect(edge.target).toContain(B.toLowerCase());
    const source = flow.nodes.find((node) => node.id === edge.source)!;
    const target = flow.nodes.find((node) => node.id === edge.target)!;
    expect(source.usdOut).toBe(2);
    expect(source.usdIn).toBe(0);
    expect(target.usdIn).toBe(2);
  });

  it('counts a transfer once even when both parties were analysed', () => {
    // The same movement appears in each side's own history; drawing it twice would double the value.
    const shared = transfer({ from: A, to: B, value: 5 });
    const flow = buildFlow([bundle(A, [shared]), bundle(B, [shared])], [], prices, EMPTY_NAMES, undefined);
    expect(flow.edges[0]!.transfers).toBe(1);
    expect(flow.totalUsd).toBe(10);
  });

  it('marks an edge whose asset could not be priced instead of dropping it', () => {
    const token = transfer({
      from: A,
      to: EXCHANGE,
      value: 100,
      asset: { kind: 'token', address: 'unknownmint', decimals: 6 },
      kind: 'token',
    });
    const flow = buildFlow([bundle(A, [token])], [], prices, EMPTY_NAMES, undefined);
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0]!.usd).toBe(0);
    expect(flow.unpricedAssets).toContain('ethereum:unknownmint');
  });

  it('ignores legs between two third parties, which are context rather than this account flow', () => {
    const unrelated = transfer({ from: FUNDER, to: EXCHANGE, value: 9 });
    const flow = buildFlow([bundle(A, [unrelated])], [], prices, EMPTY_NAMES, undefined);
    expect(flow.edges).toHaveLength(0);
  });

  it('labels a known service rather than showing a bare address', () => {
    const flow = buildFlow(
      [bundle(A, [transfer({ from: A, to: EXCHANGE, value: 1 })])],
      [],
      prices,
      EMPTY_NAMES,
      undefined,
    );
    const service = flow.nodes.find((node) => node.address.toLowerCase() === EXCHANGE.toLowerCase());
    expect(service?.label).toBeTruthy();
    expect(service?.service).toBe('exchange');
  });

  it('reports when it trimmed the picture rather than silently showing part of it', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      transfer({ from: A, to: `0x${String(i).padStart(40, '9')}`, value: i + 1 }),
    );
    const flow = buildFlow([bundle(A, many)], [], prices, EMPTY_NAMES, undefined, { ...DEFAULT_FLOW_OPTIONS, maxEdges: 5 });
    expect(flow.edges).toHaveLength(5);
    expect(flow.trimmed).toBe(true);
    // The largest flows are the ones kept.
    expect(flow.edges[0]!.usd).toBe(24);
  });
});

describe('price keys', () => {
  it('routes natives through coingecko and tokens through their chain', () => {
    expect(priceKey('ethereum', { kind: 'native' })).toBe('coingecko:ethereum');
    expect(priceKey('solana', { kind: 'native' })).toBe('coingecko:solana');
    expect(priceKey('solana', { kind: 'token', address: 'MINT' })).toBe('solana:MINT');
    expect(priceKey('ethereum', { kind: 'nft', address: '0xabc' })).toBeUndefined();
  });
});

describe('formatUsd', () => {
  it('stays readable across six orders of magnitude', () => {
    expect(formatUsd(0)).toBe('$0');
    expect(formatUsd(0.42)).toBe('$0.42');
    expect(formatUsd(940)).toBe('$940');
    expect(formatUsd(16_546_398)).toBe('$16.5M');
    expect(formatUsd(2_400_000_000)).toBe('$2.4B');
  });
});
