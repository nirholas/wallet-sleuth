import { makeRef } from './address.js';
import { buildFlow, DEFAULT_FLOW_OPTIONS, type FlowGraph } from './flow.js';
import { EMPTY_NAMES, resolveNames } from './names.js';
import { loadPrices } from './prices.js';
import { loadSanctions } from './sanctions.js';
import { buildProviders, providersFor } from './providers/registry.js';
import { StatsCollector, type ChainProvider, type FetchContext } from './providers/types.js';
import { labels } from './labels/index.js';
import { MemoryCache, type CacheStore } from './util/cache.js';
import { InvalidInputError } from './errors.js';
import type { AccountFacts, ActivityBundle, ProviderStat } from './types.js';

/**
 * Pulls one address's own value neighbourhood.
 *
 * This is what makes a flow graph an investigation rather than a snapshot. A report answers "where
 * did the money these addresses touched go"; expansion answers the question a reader immediately has
 * next, which is "and where did it go from there". Following it by hand means copying an address into
 * a fresh analysis and losing the picture already built.
 *
 * It is deliberately a smaller read than a full analysis: one address, a shallower history, and no
 * signals, because the caller wants the next hop quickly, not another minute of scoring.
 */
export interface ExpandRequest {
  chain: string;
  address: string;
  /** Transfers to read. Kept low: expansion is meant to feel immediate. */
  maxTransfers?: number;
  /** Wall clock budget in milliseconds. */
  budgetMs?: number;
}

export interface ExpandResult {
  chain: string;
  address: string;
  /** The flow neighbourhood of this one address. */
  flow: FlowGraph;
  facts: {
    label?: string;
    service?: string;
    isContract: boolean;
    sanctioned: boolean;
    balance?: number;
    transfers: number;
    /** True when the address had more history than the expansion budget allowed. */
    truncated: boolean;
  };
  warnings: string[];
  providers: ProviderStat[];
  durationMs: number;
}

export interface ExpandDeps {
  providers?: ChainProvider[];
  cache?: CacheStore;
  cacheTtlSeconds?: number;
  signal?: AbortSignal;
}

export const EXPAND_DEFAULTS = { maxTransfers: 120, budgetMs: 45_000 };

export async function expand(request: ExpandRequest, deps: ExpandDeps = {}): Promise<ExpandResult> {
  const started = Date.now();
  const ref = makeRef(request.chain, request.address);
  const maxTransfers = Math.max(20, Math.min(500, request.maxTransfers ?? EXPAND_DEFAULTS.maxTransfers));
  const budgetMs = Math.max(5_000, Math.min(120_000, request.budgetMs ?? EXPAND_DEFAULTS.budgetMs));

  const providers = deps.providers ?? buildProviders();
  const candidates = providersFor(providers, ref.chain);
  if (candidates.length === 0) {
    throw new InvalidInputError(`no data provider is configured for ${ref.chain}`);
  }

  const stats = new StatsCollector();
  const ctx: FetchContext = {
    cache: deps.cache ?? new MemoryCache(),
    cacheTtlSeconds: deps.cacheTtlSeconds ?? 900,
    stats,
    signal: deps.signal,
    deadline: started + budgetMs,
  };

  const registry = labels();
  const label = registry.lookup(ref.chain, ref.normalized);
  const facts: AccountFacts = {
    key: ref.key,
    chain: ref.chain,
    address: ref.address,
    ...(label ? { label } : {}),
  };
  const warnings: string[] = [];
  let transfers: ActivityBundle['transfers'] = [];
  let truncated = false;

  for (const provider of candidates) {
    try {
      const [activity, resolved] = await Promise.all([
        provider.fetchActivity(ref, { maxTransfers, since: 0, includeNft: false }, ctx),
        provider.fetchFacts(ref, ctx).catch(() => ({}) as Partial<AccountFacts>),
      ]);
      transfers = activity.transfers;
      truncated = activity.truncated;
      warnings.push(...activity.warnings);
      Object.assign(facts, resolved, activity.facts ?? {});
      break;
    } catch (err) {
      warnings.push(`${provider.name} failed: ${(err as Error).message}`);
    }
  }

  const bundle: ActivityBundle = {
    ref,
    facts,
    transfers,
    payers: [],
    truncated,
    reachedGenesis: false,
    warnings,
    fetchMs: Date.now() - started,
    providers: candidates.map((provider) => provider.name),
  };

  const [prices, names, sanctions] = await Promise.all([
    loadPrices(transfers, { cache: ctx.cache, signal: deps.signal }),
    ref.namespace === 'solana'
      ? resolveNames(
          {
            addresses: [...new Set(transfers.flatMap((t) => [t.from, t.to]))],
            mints: [
              ...new Set(
                transfers
                  .filter((t) => t.asset.address && !t.asset.symbol)
                  .map((t) => t.asset.address as string),
              ),
            ],
          },
          { cache: ctx.cache, signal: deps.signal, maxAddresses: 20, maxMints: 20 },
        ).catch(() => EMPTY_NAMES)
      : Promise.resolve(EMPTY_NAMES),
    loadSanctions([ref.chain], { cache: ctx.cache, signal: deps.signal }),
  ]);

  const flow = buildFlow([bundle], [], prices, names, sanctions, {
    ...DEFAULT_FLOW_OPTIONS,
    maxEdges: 40,
  });

  if (transfers.length === 0 && warnings.length > 0) {
    warnings.unshift('no activity could be read for this address, which is not the same as it having none');
  }

  return {
    chain: ref.chain,
    address: ref.address,
    flow,
    facts: {
      label: facts.label?.name ?? facts.name ?? names.domain(ref.normalized),
      service: facts.label?.kind,
      isContract: facts.isContract === true,
      sanctioned: sanctions.isSanctioned(ref.chain, ref.normalized),
      balance: facts.balance,
      transfers: transfers.length,
      truncated,
    },
    warnings,
    providers: stats.snapshot(),
    durationMs: Date.now() - started,
  };
}
