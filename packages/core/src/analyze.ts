import { randomUUID } from 'node:crypto';
import { addressUrl } from './chains.js';
import { parseAddressList } from './address.js';
import { buildClusters } from './cluster.js';
import { collectBundles, enrichCounterparties } from './collect.js';
import { InvalidInputError } from './errors.js';
import { labels } from './labels/index.js';
import { buildProviders } from './providers/registry.js';
import { StatsCollector, type ChainProvider, type FetchContext } from './providers/types.js';
import { scoreEdges } from './score.js';
import { buildFlow } from './flow.js';
import { EMPTY_NAMES, resolveNames } from './names.js';
import { loadPrices } from './prices.js';
import { loadSanctions } from './sanctions.js';
import { buildContext, runSignals, SIGNALS_BY_ID } from './signals/index.js';
import { MemoryCache, type CacheStore } from './util/cache.js';
import type {
  AccountSummary,
  AddressRef,
  AnalysisOptions,
  AnalysisReport,
  AnalysisRequest,
  HubNote,
  ProgressFn,
} from './types.js';

export const VERSION = '1.0.0';

/** Licence and canonical repository, reported by the API and the CLI so a deployment identifies itself. */
export const LICENSE = 'Proprietary, all rights reserved';
export const SOURCE_URL = 'https://github.com/nirholas/wallet-sleuth';

/** Defaults tuned to finish inside a minute on keyless public endpoints. */
export const DEFAULT_OPTIONS: AnalysisOptions = {
  maxTransfersPerAddress: 400,
  lookbackDays: 0,
  minScore: 15,
  clusterThreshold: 55,
  signals: [],
  hubShareThreshold: 8,
  enrichCounterparties: true,
  budgetMs: 120_000,
};

export const MAX_ADDRESSES = 50;

export interface AnalyzeDeps {
  providers?: ChainProvider[];
  cache?: CacheStore;
  cacheTtlSeconds?: number;
  onProgress?: ProgressFn;
  signal?: AbortSignal;
  now?: number;
}

export function resolveOptions(partial: Partial<AnalysisOptions> = {}): AnalysisOptions {
  const options: AnalysisOptions = { ...DEFAULT_OPTIONS, ...partial };
  options.maxTransfersPerAddress = clampInt(options.maxTransfersPerAddress, 25, 5000);
  options.lookbackDays = clampInt(options.lookbackDays, 0, 3650);
  options.minScore = clampInt(options.minScore, 0, 100);
  options.clusterThreshold = clampInt(options.clusterThreshold, 1, 100);
  options.hubShareThreshold = clampInt(options.hubShareThreshold, 2, 1000);
  options.budgetMs = clampInt(options.budgetMs, 5_000, 900_000);
  for (const id of options.signals) {
    if (!SIGNALS_BY_ID.has(id)) {
      throw new InvalidInputError(`unknown signal: ${id}`, { known: [...SIGNALS_BY_ID.keys()] });
    }
  }
  return options;
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/**
 * Runs a full linkage analysis.
 *
 * The pipeline is: parse and fan out addresses, collect an activity sample per address, resolve the
 * shared counterparties that decide whether co-occurrence means anything, run every signal, combine
 * the evidence into scored edges, then cluster. Each stage reports progress and each stage degrades
 * rather than fails: a provider outage costs coverage and is recorded in the report, it never
 * substitutes invented data.
 */
export async function analyze(request: AnalysisRequest, deps: AnalyzeDeps = {}): Promise<AnalysisReport> {
  const started = Date.now();
  const options = resolveOptions(request.options);
  const onProgress = deps.onProgress;

  onProgress?.({ phase: 'parse', progress: 0, message: 'parsing addresses' });
  const parsed = parseAddressList(request.addresses, request.chains);
  const explicitInputs = new Set(parsed.refs.map((ref) => ref.input));
  if (explicitInputs.size === 0) {
    throw new InvalidInputError('no valid addresses were supplied', { rejected: parsed.rejected });
  }
  if (explicitInputs.size > MAX_ADDRESSES) {
    throw new InvalidInputError(
      `too many addresses: ${explicitInputs.size} supplied, ${MAX_ADDRESSES} is the maximum per analysis`,
    );
  }

  const providers = deps.providers ?? buildProviders();
  const stats = new StatsCollector();
  const ctx: FetchContext = {
    cache: deps.cache ?? new MemoryCache(),
    cacheTtlSeconds: deps.cacheTtlSeconds ?? Number(process.env.SLEUTH_CACHE_TTL_SECONDS ?? 900),
    stats,
    signal: deps.signal,
    deadline: started + options.budgetMs,
  };

  const since = options.lookbackDays > 0 ? Math.floor(Date.now() / 1000) - options.lookbackDays * 86_400 : 0;
  const collectOptions = {
    maxTransfers: options.maxTransfersPerAddress,
    since,
    includeNft: false,
  };

  onProgress?.({ phase: 'collect', progress: 0, message: `collecting ${parsed.refs.length} addresses` });
  const collected = await collectBundles(parsed.refs, collectOptions, ctx, providers, onProgress);

  let context = new Map<string, import('./collect.js').ContextAccount>();
  if (options.enrichCounterparties && collected.bundles.length > 1) {
    onProgress?.({ phase: 'enrich', progress: 0, message: 'resolving shared counterparties' });
    context = await enrichCounterparties(
      collected.bundles,
      collectOptions,
      ctx,
      providers,
      { minShared: 2, maxAccounts: Math.min(24, 6 * collected.bundles.length), maxSamples: 4 },
      onProgress,
    );
  }

  onProgress?.({ phase: 'signals', progress: 0, message: 'running signals' });
  const signalContext = buildContext(collected.bundles, context, options, deps.now);
  const { evidence, failures } = runSignals(signalContext, options.signals);

  onProgress?.({ phase: 'score', progress: 0.85, message: 'scoring and clustering' });
  const edges = scoreEdges(evidence, options.minScore);
  const keys = collected.bundles.map((bundle) => bundle.ref.key);
  const clusters = buildClusters(edges, keys, options.clusterThreshold);

  // Valuation and naming run after the signals because nothing in the scoring depends on them:
  // they exist to make the result readable, so a slow or missing price source costs labels, never
  // the analysis itself.
  const allTransfers = collected.bundles.flatMap((bundle) => bundle.transfers);
  onProgress?.({ phase: 'score', progress: 0.92, message: 'valuing transfers and resolving names' });
  const analysedChains = [...new Set(collected.bundles.map((bundle) => bundle.ref.chain))];
  const [prices, names, sanctions] = await Promise.all([
    loadPrices(allTransfers, { cache: ctx.cache, signal: deps.signal }),
    (async () => {
      const solanaBundles = collected.bundles.filter((bundle) => bundle.ref.namespace === 'solana');
      if (solanaBundles.length === 0) return EMPTY_NAMES;
      const counterparties = new Set<string>();
      for (const bundle of solanaBundles) {
        for (const transfer of bundle.transfers) {
          counterparties.add(transfer.from);
          counterparties.add(transfer.to);
        }
      }
      const mints = new Set<string>();
      for (const transfer of allTransfers) {
        if (transfer.chain === 'solana' && transfer.asset.address && !transfer.asset.symbol) {
          mints.add(transfer.asset.address);
        }
      }
      return resolveNames(
        { addresses: [...counterparties], mints: [...mints] },
        { cache: ctx.cache, signal: deps.signal },
      ).catch(() => EMPTY_NAMES);
    })(),
    loadSanctions(analysedChains, { cache: ctx.cache, signal: deps.signal }),
  ]);

  const clusterByKey = new Map<string, string>();
  for (const cluster of clusters) for (const member of cluster.members) clusterByKey.set(member, cluster.id);

  const accounts: AccountSummary[] = collected.bundles.map((bundle) => {
    const timestamps = bundle.transfers.map((t) => t.ts).filter((ts) => ts > 0);
    return {
      key: bundle.ref.key,
      chain: bundle.ref.chain,
      address: bundle.ref.address,
      namespace: bundle.ref.namespace,
      label: bundle.facts.label,
      isContract: bundle.facts.isContract,
      delegated: bundle.facts.delegated,
      name: bundle.facts.name,
      balance: bundle.facts.balance,
      txCount: bundle.facts.txCount,
      transfersAnalyzed: bundle.transfers.length,
      firstActivity: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      lastActivity: timestamps.length > 0 ? Math.max(...timestamps) : undefined,
      counterparties: signalContext.index.get(bundle.ref.key)?.counterparties.size ?? 0,
      inbound: signalContext.index.get(bundle.ref.key)?.inbound.length ?? 0,
      outbound: signalContext.index.get(bundle.ref.key)?.outbound.length ?? 0,
      truncated: bundle.truncated,
      historyComplete: bundle.reachedGenesis,
      unreadable: bundle.facts.unreadable === true,
      sanctioned: sanctions.isSanctioned(bundle.ref.chain, bundle.ref.normalized),
      warnings: bundle.warnings,
      explorerUrl: addressUrl(bundle.ref.chain, bundle.ref.address),
      cluster: clusterByKey.get(bundle.ref.key) ?? null,
    };
  });

  const registry = labels();
  const hubs: HubNote[] = [...signalContext.hubs]
    .map((key) => {
      const idx = key.indexOf(':');
      const chain = key.slice(0, idx);
      const address = key.slice(idx + 1);
      const sharedBy = signalContext.sharedBy.get(key)?.size ?? 0;
      const label = registry.lookup(chain, address);
      const isContract = context.get(key)?.facts.isContract;
      return {
        address,
        chain,
        label,
        sharedBy,
        reason: label
          ? `labelled ${label.kind}: ${label.name}`
          : isContract
            ? 'contract, so interaction is open to anyone'
            : `touched by ${sharedBy} of the analysed addresses`,
      } satisfies HubNote;
    })
    .filter((hub) => hub.sharedBy >= 2)
    .sort((a, b) => b.sharedBy - a.sharedBy);

  const warnings = [...failures];
  if (collected.dropped.length > 0) {
    warnings.push(
      `${collected.dropped.length} inferred chain/address pair(s) had no activity and were dropped: ${summarizeDropped(collected.dropped)}`,
    );
  }
  if (Date.now() >= ctx.deadline) {
    warnings.push(
      `the ${Math.round(options.budgetMs / 1000)}s collection budget was reached, so some history was not read; raise budgetMs or narrow the address list for a deeper pass`,
    );
  }
  // The loudest caveat there is: a "no links" result computed over an address nobody could read is
  // not a finding about that address, and the report must not let it pass for one.
  const unreadable = accounts.filter((account) => account.unreadable);
  if (unreadable.length > 0) {
    warnings.push(
      `${unreadable
        .map((account) => account.address)
        .join(', ')}: activity exists on chain but no configured provider could serve it, so nothing was analysed for ${unreadable.length === 1 ? 'this address' : 'these addresses'}. Any conclusion about ${unreadable.length === 1 ? 'it' : 'them'}, including the absence of links, is unsupported until a provider that holds this history is configured.`,
    );
  }

  const sanctioned = accounts.filter((account) => account.sanctioned);
  if (sanctioned.length > 0) {
    warnings.unshift(
      `SANCTIONS: ${sanctioned.map((account) => account.address).join(', ')} ${sanctioned.length === 1 ? 'appears' : 'appear'} on the OFAC sanctions list for ${sanctioned.length === 1 ? 'its' : 'their'} chain. Verify against the Treasury SDN register before acting on this.`,
    );
  }
  if (!sanctions.complete) {
    warnings.push(
      `sanctions screening was incomplete (${sanctions.unavailable.join(', ')} unavailable), so no address here can be described as screened clean`,
    );
  }

  const labelledInputs = accounts.filter((account) => account.label?.hub);
  if (labelledInputs.length > 0) {
    warnings.push(
      `${labelledInputs
        .map((account) => `${account.address} (${account.label?.name})`)
        .join(', ')} ${labelledInputs.length === 1 ? 'is a known service address' : 'are known service addresses'}; links involving them describe the service and its users, not a single person`,
    );
  }
  const blindToGenesis = accounts.filter((account) => !account.historyComplete);
  if (blindToGenesis.length > 0) {
    warnings.push(
      `first-funding signals were withheld for ${blindToGenesis.length} address(es) whose full history could not be read, because the earliest transfer in a partial sample is not the account's opening balance`,
    );
  }
  if (accounts.some((account) => account.truncated)) {
    warnings.push(
      'one or more addresses have more history than the transfer budget allowed; results describe the sample, not the complete history',
    );
  }

  const chains = [...new Set(accounts.map((account) => account.chain))].sort();

  return {
    id: randomUUID(),
    version: VERSION,
    createdAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    options,
    accounts,
    edges,
    clusters,
    hubs,
    warnings,
    providers: stats.snapshot(),
    rejected: parsed.rejected,
    flow: buildFlow(collected.bundles, clusters, prices, names, sanctions),
    summary: {
      addresses: accounts.length,
      linked: new Set(edges.flatMap((edge) => [edge.a, edge.b])).size,
      clusters: clusters.length,
      strongestScore: edges[0]?.score ?? 0,
      transfersAnalyzed: collected.bundles.reduce((sum, bundle) => sum + bundle.transfers.length, 0),
      chains,
    },
  };
}

function summarizeDropped(refs: AddressRef[]): string {
  const byChain = new Map<string, number>();
  for (const ref of refs) byChain.set(ref.chain, (byChain.get(ref.chain) ?? 0) + 1);
  return [...byChain.entries()].map(([chain, count]) => `${chain} x${count}`).join(', ');
}
