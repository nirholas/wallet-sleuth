import { getChain } from './chains.js';
import { cached, type CacheStore } from './util/cache.js';
import { fetchJson } from './util/http.js';
import type { Asset, Transfer } from './types.js';

/**
 * USD valuation for transfers, from a keyless public endpoint.
 *
 * A flow graph whose edges are labelled "1,196,722 of orcaEK..." tells a reader nothing about
 * whether that edge matters. Converting to USD is what turns a picture of activity into a picture of
 * value, and it is the difference between a graph you look at and a graph you reason with.
 *
 * DefiLlama's coins API is used because it is genuinely keyless, covers both namespaces with one
 * request shape (`solana:<mint>`, `ethereum:<contract>`, `coingecko:<id>` for natives), and reports
 * a confidence score per asset so a thin-liquidity quote can be discarded rather than believed.
 */
const ENDPOINT = 'https://coins.llama.fi/prices/current/';

/** Below this, DefiLlama's own confidence in the quote is too low to put a dollar sign on. */
const MIN_CONFIDENCE = 0.7;

/** DefiLlama accepts long paths, but batching keeps a single failure from costing every price. */
const BATCH = 30;

export interface PriceQuote {
  symbol?: string;
  /** USD price per whole unit. */
  price: number;
  confidence: number;
}

interface LlamaResponse {
  coins?: Record<string, { symbol?: string; price?: number; confidence?: number; decimals?: number }>;
}

/** The DefiLlama key for an asset, or undefined when it cannot be priced. */
export function priceKey(chain: string, asset: Asset): string | undefined {
  if (asset.kind === 'nft') return undefined;
  if (asset.kind === 'native') {
    const id = getChain(chain).coingeckoId;
    return id ? `coingecko:${id}` : undefined;
  }
  if (!asset.address) return undefined;
  return `${chain}:${asset.address}`;
}

export interface PriceBook {
  get(chain: string, asset: Asset): PriceQuote | undefined;
  /** USD value of a transfer, or undefined when the asset could not be priced. */
  usd(transfer: Transfer): number | undefined;
  /** Assets that no price could be found for, so a report can say what it left out. */
  readonly unpriced: string[];
  readonly resolved: number;
}

class Book implements PriceBook {
  private quotes = new Map<string, PriceQuote>();
  private missing = new Set<string>();

  constructor(quotes: Map<string, PriceQuote>, missing: Set<string>) {
    this.quotes = quotes;
    this.missing = missing;
  }

  get(chain: string, asset: Asset): PriceQuote | undefined {
    const key = priceKey(chain, asset);
    return key ? this.quotes.get(key) : undefined;
  }

  usd(transfer: Transfer): number | undefined {
    const quote = this.get(transfer.chain, transfer.asset);
    if (!quote) return undefined;
    return transfer.value * quote.price;
  }

  get unpriced(): string[] {
    return [...this.missing];
  }

  get resolved(): number {
    return this.quotes.size;
  }
}

/**
 * Prices every distinct asset in a transfer set.
 *
 * Failures are absorbed: an unpriced asset simply has no dollar value in the report, which is a
 * smaller lie than a wrong one. Nothing here can fail an analysis.
 */
export async function loadPrices(
  transfers: Transfer[],
  deps: { cache: CacheStore; ttlSeconds?: number; signal?: AbortSignal },
): Promise<PriceBook> {
  const wanted = new Map<string, string>();
  for (const transfer of transfers) {
    const key = priceKey(transfer.chain, transfer.asset);
    if (key) wanted.set(key, transfer.asset.symbol ?? '');
    else if (transfer.asset.address) wanted.set(`unpriceable:${transfer.chain}:${transfer.asset.address}`, '');
  }

  const keys = [...wanted.keys()].filter((key) => !key.startsWith('unpriceable:'));
  const quotes = new Map<string, PriceQuote>();
  const missing = new Set<string>(
    [...wanted.keys()].filter((key) => key.startsWith('unpriceable:')).map((key) => key.slice('unpriceable:'.length)),
  );
  if (keys.length === 0) return new Book(quotes, missing);

  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += BATCH) batches.push(keys.slice(i, i + BATCH));

  await Promise.all(
    batches.map(async (batch) => {
      const url = `${ENDPOINT}${batch.join(',')}`;
      try {
        const response = await cached(deps.cache, `prices:${batch.join(',')}`, deps.ttlSeconds ?? 300, () =>
          fetchJson<LlamaResponse>('defillama', url, { timeoutMs: 15_000, retries: 1, signal: deps.signal }),
        );
        for (const key of batch) {
          const coin = response.coins?.[key];
          if (!coin || typeof coin.price !== 'number' || (coin.confidence ?? 1) < MIN_CONFIDENCE) {
            missing.add(key);
            continue;
          }
          quotes.set(key, { symbol: coin.symbol, price: coin.price, confidence: coin.confidence ?? 1 });
        }
      } catch {
        // A pricing outage costs dollar labels, never the analysis.
        for (const key of batch) missing.add(key);
      }
    }),
  );

  return new Book(quotes, missing);
}

/** Compact USD formatting: readable at a glance on a graph edge. */
export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  if (abs >= 1) return `$${value.toFixed(0)}`;
  if (abs === 0) return '$0';
  return `$${value.toFixed(2)}`;
}
