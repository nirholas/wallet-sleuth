import type { CacheStore } from '../util/cache.js';
import type { AccountFacts, AddressRef, ChainDescriptor, Namespace, ProviderStat, Transfer } from '../types.js';

export interface CollectOptions {
  /** Hard cap on transfers pulled for one address. */
  maxTransfers: number;
  /** Ignore activity older than this unix second. 0 disables the cutoff. */
  since: number;
  /** Include ERC-721 / ERC-1155 movements. Costs one more upstream call per address. */
  includeNft: boolean;
}

export interface ProviderActivity {
  transfers: Transfer[];
  /** Fee payers or transaction senders seen paying for this account's activity. */
  payers: string[];
  truncated: boolean;
  /** True when the walk reached the account's earliest transaction. */
  reachedGenesis: boolean;
  warnings: string[];
  /** Facts the activity walk happened to reveal, merged into the account record. */
  facts?: Partial<AccountFacts>;
}

/** Accumulates per-provider request counts so a report can explain where its data came from. */
export class StatsCollector {
  private rows = new Map<string, ProviderStat>();

  record(provider: string, chain: string, info: { ms: number; ok: boolean; note?: string }): void {
    const key = `${provider}|${chain}`;
    const row = this.rows.get(key) ?? { provider, chain, requests: 0, errors: 0, ms: 0 };
    row.requests += 1;
    row.ms += info.ms;
    if (!info.ok) row.errors += 1;
    if (info.note) row.note = info.note;
    this.rows.set(key, row);
  }

  note(provider: string, chain: string, note: string): void {
    const key = `${provider}|${chain}`;
    const row = this.rows.get(key) ?? { provider, chain, requests: 0, errors: 0, ms: 0 };
    row.note = note;
    this.rows.set(key, row);
  }

  snapshot(): ProviderStat[] {
    return [...this.rows.values()].sort((a, b) => b.requests - a.requests);
  }
}

export interface FetchContext {
  cache: CacheStore;
  cacheTtlSeconds: number;
  stats: StatsCollector;
  signal?: AbortSignal;
  /** Epoch milliseconds after which collection should stop and return what it has. */
  deadline: number;
}

export interface ChainProvider {
  readonly name: string;
  readonly namespace: Namespace;
  /** Priority, highest first. A configured API key outranks a keyless public endpoint. */
  readonly priority: number;
  supports(chain: ChainDescriptor): boolean;
  fetchActivity(ref: AddressRef, options: CollectOptions, ctx: FetchContext): Promise<ProviderActivity>;
  fetchFacts(ref: AddressRef, ctx: FetchContext): Promise<Partial<AccountFacts>>;
}

export function outOfTime(ctx: FetchContext): boolean {
  return Date.now() >= ctx.deadline;
}
