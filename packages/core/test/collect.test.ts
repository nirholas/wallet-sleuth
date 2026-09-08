import { describe, expect, it } from 'vitest';
import { collectBundles } from '../src/collect.js';
import { makeRef } from '../src/address.js';
import { MemoryCache } from '../src/util/cache.js';
import { StatsCollector, type ChainProvider, type FetchContext, type ProviderActivity } from '../src/providers/types.js';
import type { AccountFacts, ChainDescriptor } from '../src/types.js';

function context(): FetchContext {
  return {
    cache: new MemoryCache(),
    cacheTtlSeconds: 60,
    stats: new StatsCollector(),
    deadline: Date.now() + 10_000,
  };
}

/** A stand-in provider so collection can be tested without a network. It never invents chain data. */
class StubProvider implements ChainProvider {
  readonly namespace = 'evm' as const;

  constructor(
    readonly name: string,
    readonly priority: number,
    private readonly behaviour: () => Promise<ProviderActivity>,
    private readonly facts: Partial<AccountFacts> = {},
  ) {}

  supports(chain: ChainDescriptor): boolean {
    return chain.namespace === 'evm';
  }

  async fetchActivity(): Promise<ProviderActivity> {
    return this.behaviour();
  }

  async fetchFacts(): Promise<Partial<AccountFacts>> {
    return this.facts;
  }
}

const EMPTY: ProviderActivity = {
  transfers: [],
  payers: [],
  truncated: false,
  reachedGenesis: true,
  warnings: [],
};

const OPTIONS = { maxTransfers: 50, since: 0, includeNft: false };
const A = '0x1111111111111111111111111111111111111111';

describe('provider failover', () => {
  it('falls through to the next provider when the first one fails', async () => {
    const failing = new StubProvider('failing', 100, async () => {
      throw new Error('rate limited');
    });
    const working = new StubProvider('working', 10, async () => ({ ...EMPTY, transfers: [] }));

    const result = await collectBundles([makeRef('ethereum', A)], OPTIONS, context(), [failing, working]);
    const bundle = result.bundles[0]!;
    expect(bundle.providers).toEqual(['working']);
    // The failure is still reported: a fallback that hides an outage is a fallback that lies.
    expect(bundle.warnings.some((warning) => /failing failed/.test(warning))).toBe(true);
  });

  it('keeps an address whose providers all failed, with the reason attached', async () => {
    const failing = new StubProvider('failing', 100, async () => {
      throw new Error('everything is down');
    });
    const result = await collectBundles([makeRef('ethereum', A)], OPTIONS, context(), [failing]);
    expect(result.bundles).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
    expect(result.bundles[0]!.warnings.join(' ')).toMatch(/everything is down/);
  });
});

describe('dropping inferred chains', () => {
  it('drops a chain guess that was looked up successfully and found empty', async () => {
    const provider = new StubProvider('stub', 10, async () => EMPTY);
    const inferred = makeRef('ethereum', A, A, false);
    const result = await collectBundles([inferred], OPTIONS, context(), [provider]);
    expect(result.bundles).toHaveLength(0);
    expect(result.dropped).toHaveLength(1);
  });

  it('never drops a chain the caller named explicitly', async () => {
    const provider = new StubProvider('stub', 10, async () => EMPTY);
    const result = await collectBundles([makeRef('ethereum', A)], OPTIONS, context(), [provider]);
    expect(result.bundles).toHaveLength(1);
    expect(result.dropped).toHaveLength(0);
  });

  it('never drops a chain guess whose lookup failed, because that is not evidence of no activity', async () => {
    const failing = new StubProvider('failing', 10, async () => {
      throw new Error('provider unavailable');
    });
    const inferred = makeRef('ethereum', A, A, false);
    const result = await collectBundles([inferred], OPTIONS, context(), [failing]);
    expect(result.dropped).toHaveLength(0);
    expect(result.bundles).toHaveLength(1);
  });

  it('keeps an empty address that still holds a balance', async () => {
    const provider = new StubProvider('stub', 10, async () => EMPTY, { balance: 1.5 });
    const inferred = makeRef('ethereum', A, A, false);
    const result = await collectBundles([inferred], OPTIONS, context(), [provider]);
    expect(result.bundles).toHaveLength(1);
  });
});

describe('bundle assembly', () => {
  it('reports when no provider supports the chain at all', async () => {
    const result = await collectBundles([makeRef('ethereum', A)], OPTIONS, context(), []);
    expect(result.bundles[0]!.warnings.join(' ')).toMatch(/no data provider/);
  });

  it('carries the provider completeness flags onto the bundle', async () => {
    const provider = new StubProvider('stub', 10, async () => ({
      ...EMPTY,
      truncated: true,
      reachedGenesis: false,
      transfers: [],
    }));
    const result = await collectBundles([makeRef('ethereum', A)], OPTIONS, context(), [provider]);
    expect(result.bundles[0]!.truncated).toBe(true);
    expect(result.bundles[0]!.reachedGenesis).toBe(false);
  });
});

describe('unreadable addresses', () => {
  it('marks an address whose activity exists but could not be served', async () => {
    // The failure this guards against: public Solana RPCs prune old slots, so getTransaction
    // returns null for signatures the address index still lists. Reporting that as an idle address
    // turns a coverage gap into a finding.
    const pruned = new StubProvider('pruned', 10, async () => ({
      ...EMPTY,
      transfers: [],
      warnings: ['40 of 40 transactions could not be read back: the endpoints do not retain that history'],
    }));
    const result = await collectBundles([makeRef('ethereum', A)], OPTIONS, context(), [pruned]);
    expect(result.bundles[0]!.facts.unreadable).toBe(true);
  });

  it('does not mark a genuinely idle address as unreadable', async () => {
    const quiet = new StubProvider('quiet', 10, async () => EMPTY);
    const result = await collectBundles([makeRef('ethereum', A)], OPTIONS, context(), [quiet]);
    expect(result.bundles[0]!.facts.unreadable).toBeUndefined();
  });
});
