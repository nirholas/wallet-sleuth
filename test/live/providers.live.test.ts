import { describe, expect, it } from 'vitest';
import {
  analyze,
  BlockscoutProvider,
  makeRef,
  MemoryCache,
  SolanaRpcProvider,
  StatsCollector,
  type FetchContext,
} from '../../packages/core/src/index.js';

/**
 * Integration tests against the real public endpoints Wallet Sleuth ships with.
 *
 * They are skipped unless `SLEUTH_LIVE=1`, because they depend on third-party availability and would
 * otherwise make an unrelated change look broken. Run them with `npm run test:live` before a release
 * and whenever a provider's behaviour is in question: everything here has failed in production at
 * least once, which is why it is asserted.
 */
const live = process.env.SLEUTH_LIVE === '1';
const describeLive = live ? describe : describe.skip;

/**
 * Public endpoints throttle, and a live test that fails because one is currently rate limiting this
 * IP reports nothing about the code. Provider unavailability is surfaced as a clear skip so a real
 * regression is never lost in the noise of an endpoint having a bad day.
 */
function skipIfUnavailable(err: unknown, ctx: { skip: (note?: string) => void }): never | void {
  const message = (err as Error)?.message ?? '';
  if (/HTTP 429|rate limit|Too many requests|no dataset could be read|endpoints failed/i.test(message)) {
    ctx.skip(`upstream provider unavailable right now: ${message.slice(0, 140)}`);
    return;
  }
  throw err;
}

function context(budgetMs = 90_000): FetchContext {
  return {
    cache: new MemoryCache(),
    cacheTtlSeconds: 900,
    stats: new StatsCollector(),
    deadline: Date.now() + budgetMs,
  };
}

// Publicly attributed, high-visibility addresses. Used as read-only test targets.
const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const BINANCE_SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const BINANCE_SOL_2 = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

describeLive('Blockscout provider', () => {
  it('reads real Ethereum history and reaches the account opening', async (ctxTest) => {
    const provider = new BlockscoutProvider();
    const ref = makeRef('ethereum', VITALIK);
    let activity;
    try {
      activity = await provider.fetchActivity(ref, { maxTransfers: 60, since: 0, includeNft: false }, context());
    } catch (err) {
      return skipIfUnavailable(err, ctxTest);
    }

    expect(activity.transfers.length).toBeGreaterThan(10);
    // The ascending pass is what proves genesis, and it gets its own attempt even when the
    // descending pass is rate limited, so a successful walk always establishes it.
    expect(activity.reachedGenesis).toBe(true);
    for (const transfer of activity.transfers) {
      expect(transfer.txHash).toMatch(/^0x[0-9a-f]{64}$/i);
      expect(transfer.from).toMatch(/^0x[0-9a-f]{40}$/);
      expect(transfer.ts).toBeGreaterThan(1_400_000_000);
      expect(Number.isFinite(transfer.value)).toBe(true);
    }
    const involved = activity.transfers.some((t) => t.from === ref.normalized || t.to === ref.normalized);
    expect(involved).toBe(true);
  }, 180_000);

  it('resolves account facts', async (ctxTest) => {
    const provider = new BlockscoutProvider();
    const facts = await provider.fetchFacts(makeRef('ethereum', VITALIK), context(30_000));
    if (facts.balance === undefined && facts.isContract === undefined) {
      return ctxTest.skip('the public explorer returned no facts, most likely rate limiting this address');
    }
    // vitalik.eth carries EIP-7702 delegated code, which explorers report as a contract. Wallet Sleuth must
    // classify it as the wallet it is, or every shared-counterparty signal would discard it.
    expect(facts.isContract).toBe(false);
    expect(facts.delegated).toBe(true);
    expect(facts.delegateTo).toMatch(/^0x[0-9a-f]{40}$/);
    expect(facts.balance).toBeGreaterThan(0);
  }, 60_000);
});

describeLive('Solana provider', () => {
  it('reads real Solana history with no unresolved transactions', async () => {
    const provider = new SolanaRpcProvider();
    const ref = makeRef('solana', BINANCE_SOL);
    const ctx = context();
    const activity = await provider.fetchActivity(ref, { maxTransfers: 40, since: 0, includeNft: false }, ctx);

    expect(activity.warnings.filter((w) => w.includes('could not be read'))).toHaveLength(0);
    expect(activity.payers.length).toBeGreaterThan(0);
    for (const transfer of activity.transfers) {
      expect(transfer.chain).toBe('solana');
      expect(transfer.txHash.length).toBeGreaterThan(40);
      expect(Number.isFinite(transfer.value)).toBe(true);
    }
  }, 180_000);

  it('identifies an SPL mint account as executable-adjacent state, not a wallet transfer', async () => {
    const provider = new SolanaRpcProvider();
    const facts = await provider.fetchFacts(makeRef('solana', USDC_SOL), context(30_000));
    expect(facts.balance).toBeGreaterThan(0);
    expect(facts.solanaTokenAccount).toBeUndefined();
  }, 60_000);
});

describeLive('end to end', () => {
  it('links two wallets operated by the same exchange, with checkable evidence', async () => {
    const report = await analyze({
      addresses: [BINANCE_SOL, BINANCE_SOL_2],
      options: { maxTransfersPerAddress: 80, budgetMs: 120_000 },
    });

    expect(report.accounts).toHaveLength(2);
    expect(report.edges.length).toBeGreaterThan(0);

    const edge = report.edges[0];
    expect(edge?.score).toBeGreaterThan(60);
    expect(edge?.evidence.length).toBeGreaterThan(0);
    for (const evidence of edge?.evidence ?? []) {
      expect(evidence.detail.length).toBeGreaterThan(20);
      for (const reference of evidence.references) {
        if (reference.url) expect(reference.url).toMatch(/^https:\/\//);
      }
    }
    expect(report.warnings.join(' ')).toContain('known service');
  }, 240_000);

  it('does not manufacture a link between unrelated addresses', async () => {
    const report = await analyze({
      addresses: [VITALIK, '0x00000000219ab540356cBB839Cbe05303d7705Fa'],
      chains: ['ethereum'],
      options: { maxTransfersPerAddress: 60, budgetMs: 90_000, minScore: 40 },
    });
    const strong = report.edges.filter((edge) => edge.band === 'confirmed');
    expect(strong).toHaveLength(0);
  }, 240_000);
});

describeLive('keyless enrichment', () => {
  it('prices both namespaces from one source', async () => {
    const { loadPrices } = await import('../../packages/core/src/prices.js');
    const { MemoryCache } = await import('../../packages/core/src/util/cache.js');
    const transfers = [
      {
        chain: 'ethereum',
        txHash: '0x' + 'a'.repeat(64),
        ts: 1_700_000_000,
        from: '0x1',
        to: '0x2',
        kind: 'native' as const,
        asset: { kind: 'native' as const, symbol: 'ETH', decimals: 18 },
        rawValue: '1',
        value: 1,
        success: true,
        index: 0,
      },
      {
        chain: 'solana',
        txHash: 'sig',
        ts: 1_700_000_000,
        from: 'a',
        to: 'b',
        kind: 'token' as const,
        asset: { kind: 'token' as const, address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
        rawValue: '1000000',
        value: 1,
        success: true,
        index: 0,
      },
    ];
    const prices = await loadPrices(transfers, { cache: new MemoryCache() });
    // A dollar of USDC is a dollar; ETH is worth rather more. Both must resolve from one call.
    expect(prices.usd(transfers[1]!)).toBeGreaterThan(0.9);
    expect(prices.usd(transfers[1]!)).toBeLessThan(1.1);
    expect(prices.usd(transfers[0]!)).toBeGreaterThan(50);
  }, 60_000);

  it('screens against the live OFAC list', async () => {
    const { loadSanctions } = await import('../../packages/core/src/sanctions.js');
    const { MemoryCache } = await import('../../packages/core/src/util/cache.js');
    const screen = await loadSanctions(['ethereum', 'solana'], { cache: new MemoryCache() });
    expect(screen.complete).toBe(true);
    // An address with no plausible reason to be listed must not be.
    expect(screen.isSanctioned('ethereum', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
  }, 60_000);
});
