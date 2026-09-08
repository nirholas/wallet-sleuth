import pLimit from 'p-limit';
import { addressKey, makeRef } from './address.js';
import { labels } from './labels/index.js';
import { providersFor } from './providers/registry.js';
import type { ChainProvider, CollectOptions, FetchContext } from './providers/types.js';
import type { AccountFacts, ActivityBundle, AddressRef, ProgressFn, Transfer } from './types.js';

/** A counterparty Wallet Sleuth looked up to decide whether it is a hub, a contract or a deposit address. */
export interface ContextAccount {
  key: string;
  chain: string;
  address: string;
  facts: AccountFacts;
  /** Small activity sample, present only for deposit-address candidates. */
  sample?: Transfer[];
  /** Set when the sample shows this address forwarding into a labelled service. */
  forwardsTo?: { address: string; name: string };
}

export interface CollectResult {
  bundles: ActivityBundle[];
  context: Map<string, ContextAccount>;
  /** Refs dropped because a fanned-out chain guess turned out to be empty. */
  dropped: AddressRef[];
}

function baseFacts(ref: AddressRef): AccountFacts {
  const label = labels().lookup(ref.chain, ref.normalized);
  return { key: ref.key, chain: ref.chain, address: ref.address, ...(label ? { label } : {}) };
}

/**
 * Pulls the activity sample for every input address.
 *
 * Providers are tried highest priority first and a failure falls through to the next one. When
 * every provider for a chain fails, the account is still reported, with the failure recorded in its
 * warnings, because silently dropping an address would understate the analysis.
 */
export async function collectBundles(
  refs: AddressRef[],
  options: CollectOptions,
  ctx: FetchContext,
  providers: ChainProvider[],
  onProgress?: ProgressFn,
): Promise<CollectResult> {
  const limit = pLimit(4);
  let done = 0;

  const bundles = await Promise.all(
    refs.map((ref) =>
      limit(async () => {
        const started = Date.now();
        const candidates = providersFor(providers, ref.chain);
        const bundle: ActivityBundle = {
          ref,
          facts: baseFacts(ref),
          transfers: [],
          payers: [],
          truncated: false,
          reachedGenesis: false,
          warnings: [],
          fetchMs: 0,
          providers: [],
        };

        if (candidates.length === 0) {
          bundle.warnings.push(`no data provider is configured for ${ref.chain}`);
        }

        for (const provider of candidates) {
          try {
            const [activity, facts] = await Promise.all([
              provider.fetchActivity(ref, options, ctx),
              provider.fetchFacts(ref, ctx).catch(() => ({}) as Partial<AccountFacts>),
            ]);
            bundle.transfers = activity.transfers;
            bundle.payers = activity.payers;
            bundle.truncated = activity.truncated;
            bundle.reachedGenesis = activity.reachedGenesis;
            bundle.warnings.push(...activity.warnings);
            bundle.facts = { ...bundle.facts, ...facts, ...(activity.facts ?? {}) };
            bundle.providers.push(provider.name);
            break;
          } catch (err) {
            bundle.warnings.push(`${provider.name} failed: ${(err as Error).message}`);
          }
        }

        const inbound = bundle.transfers
          .filter((t) => t.to === ref.normalized && t.value > 0 && t.success)
          .sort((a, b) => a.ts - b.ts);
        if (inbound[0]) bundle.firstInbound = inbound[0];
        bundle.facts.txCount = bundle.transfers.length;
        bundle.fetchMs = Date.now() - started;

        done += 1;
        onProgress?.({
          phase: 'collect',
          progress: done / Math.max(1, refs.length),
          message: `collected ${done}/${refs.length} addresses`,
          detail: `${ref.chain} ${ref.address}`,
        });
        return bundle;
      }),
    ),
  );

  const kept: ActivityBundle[] = [];
  const dropped: AddressRef[] = [];
  for (const bundle of bundles) {
    const empty = bundle.transfers.length === 0 && !(bundle.facts.balance && bundle.facts.balance > 0);
    // Only drop an inferred chain guess when the lookup actually succeeded and found nothing. A
    // provider failure is not evidence of an unused address, and quietly dropping it would hide the
    // outage instead of reporting it.
    const lookedSuccessfully = bundle.warnings.length === 0;
    if (empty && lookedSuccessfully && !bundle.ref.explicit) dropped.push(bundle.ref);
    else kept.push(bundle);
  }

  return { bundles: kept, context: new Map(), dropped };
}

export interface EnrichOptions {
  /** Counterparties shared by at least this many inputs are looked up. */
  minShared: number;
  /** Maximum counterparties to resolve. */
  maxAccounts: number;
  /** Of those, how many get a small activity sample to test the deposit-address hypothesis. */
  maxSamples: number;
}

/**
 * Resolves shared counterparties.
 *
 * This is what separates "both addresses touched the same thing" from "both addresses paid into the
 * same personal deposit account". Without it, a shared exchange router looks identical to a shared
 * deposit address, and the second one is the only one that means anything.
 */
export async function enrichCounterparties(
  bundles: ActivityBundle[],
  options: CollectOptions,
  ctx: FetchContext,
  providers: ChainProvider[],
  settings: EnrichOptions,
  onProgress?: ProgressFn,
): Promise<Map<string, ContextAccount>> {
  const registry = labels();
  const inputs = new Set(bundles.map((b) => b.ref.key));
  const sharedBy = new Map<string, Set<string>>();

  for (const bundle of bundles) {
    const seen = new Set<string>();
    for (const transfer of bundle.transfers) {
      for (const party of [transfer.from, transfer.to]) {
        if (!party || party === bundle.ref.normalized) continue;
        const key = addressKey(bundle.ref.chain, party);
        if (inputs.has(key) || seen.has(key)) continue;
        seen.add(key);
        const holders = sharedBy.get(key) ?? new Set<string>();
        holders.add(bundle.ref.key);
        sharedBy.set(key, holders);
      }
    }
  }

  const candidates = [...sharedBy.entries()]
    .filter(([key, holders]) => {
      if (holders.size < settings.minShared) return false;
      const idx = key.indexOf(':');
      const chain = key.slice(0, idx);
      const address = key.slice(idx + 1);
      return !registry.isHub(chain, address);
    })
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, settings.maxAccounts);

  const out = new Map<string, ContextAccount>();
  const limit = pLimit(4);
  let sampled = 0;

  await Promise.all(
    candidates.map(([key], position) =>
      limit(async () => {
        if (Date.now() >= ctx.deadline) return;
        const idx = key.indexOf(':');
        const chainSlug = key.slice(0, idx);
        const address = key.slice(idx + 1);
        let ref: AddressRef;
        try {
          ref = makeRef(chainSlug, address, address);
        } catch {
          return;
        }
        const candidatesForChain = providersFor(providers, chainSlug);
        const provider = candidatesForChain[0];
        if (!provider) return;

        const facts: AccountFacts = baseFacts(ref);
        try {
          Object.assign(facts, await provider.fetchFacts(ref, ctx));
        } catch {
          /* facts are best effort: a counterparty we cannot resolve is simply less informative */
        }

        const entry: ContextAccount = { key, chain: chainSlug, address: ref.address, facts };

        const wantsSample =
          position < settings.maxSamples && !facts.isContract && !facts.label && sampled < settings.maxSamples;
        if (wantsSample && Date.now() < ctx.deadline) {
          sampled += 1;
          try {
            const activity = await provider.fetchActivity(
              ref,
              { maxTransfers: 40, since: options.since, includeNft: false },
              ctx,
            );
            entry.sample = activity.transfers;
            for (const transfer of activity.transfers) {
              if (transfer.from !== ref.normalized) continue;
              const label = registry.lookup(chainSlug, transfer.to);
              if (label && (label.kind === 'exchange' || label.kind === 'bridge')) {
                entry.forwardsTo = { address: transfer.to, name: label.name };
                break;
              }
            }
          } catch {
            /* a missing sample only costs us the deposit-address upgrade, never correctness */
          }
        }

        out.set(key, entry);
        onProgress?.({
          phase: 'enrich',
          progress: out.size / Math.max(1, candidates.length),
          message: `resolved ${out.size}/${candidates.length} shared counterparties`,
          detail: `${chainSlug} ${ref.address}`,
        });
      }),
    ),
  );

  return out;
}
