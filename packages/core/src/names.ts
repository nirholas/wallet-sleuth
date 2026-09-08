import pLimit from 'p-limit';
import { cached, type CacheStore } from './util/cache.js';
import { fetchJson } from './util/http.js';

/**
 * Human names for addresses and assets, from keyless public endpoints.
 *
 * A graph of base58 strings is unreadable, and the reader's eye needs an anchor: the difference
 * between "9WzDXw...AWWM" and "Binance hot wallet" is the difference between a diagram and an
 * explanation. Curated labels cover the services; these two lanes cover the rest.
 *
 * EVM names arrive already, in Blockscout's `ens_domain_name`. Solana has no equivalent in the RPC,
 * so `.sol` domains come from Bonfida's public SNS API, and mint symbols from Jupiter's token
 * search. Both are keyless, both are best effort, and neither can fail an analysis.
 */
const SNS_ENDPOINT = 'https://sns-api.bonfida.com/v2/user/domains/';
const JUPITER_ENDPOINT = 'https://lite-api.jup.ag/tokens/v2/search?query=';

const DAY = 24 * 3600;

export interface NameBook {
  /** `.sol` domain for a Solana address, when it has one. */
  domain(address: string): string | undefined;
  /** Symbol for a Solana mint, when it is a known token. */
  symbol(mint: string): string | undefined;
}

class Book implements NameBook {
  constructor(
    private readonly domains: Map<string, string>,
    private readonly symbols: Map<string, string>,
  ) {}

  domain(address: string): string | undefined {
    return this.domains.get(address);
  }

  symbol(mint: string): string | undefined {
    return this.symbols.get(mint);
  }
}

export const EMPTY_NAMES: NameBook = new Book(new Map(), new Map());

export interface ResolveNamesInput {
  /** Solana wallet addresses to reverse resolve. */
  addresses: string[];
  /** Solana mints to name. */
  mints: string[];
}

export async function resolveNames(
  input: ResolveNamesInput,
  deps: { cache: CacheStore; signal?: AbortSignal; maxAddresses?: number; maxMints?: number },
): Promise<NameBook> {
  const domains = new Map<string, string>();
  const symbols = new Map<string, string>();
  const limit = pLimit(4);

  const addresses = [...new Set(input.addresses)].slice(0, deps.maxAddresses ?? 30);
  const mints = [...new Set(input.mints)].slice(0, deps.maxMints ?? 40);

  await Promise.all([
    ...addresses.map((address) =>
      limit(async () => {
        try {
          const result = await cached(deps.cache, `sns:${address}`, DAY, () =>
            fetchJson<Record<string, string[]>>('bonfida', `${SNS_ENDPOINT}${address}`, {
              timeoutMs: 10_000,
              retries: 0,
              signal: deps.signal,
            }),
          );
          const first = result?.[address]?.[0];
          if (first) domains.set(address, `${first}.sol`);
        } catch {
          // A missing domain is the common case, not an error worth surfacing.
        }
      }),
    ),
    ...mints.map((mint) =>
      limit(async () => {
        try {
          const result = await cached(deps.cache, `jup:${mint}`, DAY, () =>
            fetchJson<{ id?: string; symbol?: string }[]>('jupiter', `${JUPITER_ENDPOINT}${mint}`, {
              timeoutMs: 10_000,
              retries: 0,
              signal: deps.signal,
            }),
          );
          const match = result?.find((entry) => entry.id === mint) ?? result?.[0];
          if (match?.symbol) symbols.set(mint, match.symbol);
        } catch {
          // An unnamed mint renders as its shortened address, which is still checkable.
        }
      }),
    ),
  ]);

  return new Book(domains, symbols);
}
