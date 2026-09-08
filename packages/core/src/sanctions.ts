import { cached, type CacheStore } from './util/cache.js';
import { fetchJson } from './util/http.js';

/**
 * OFAC sanctions screening, from a keyless public mirror of the Treasury SDN list.
 *
 * A tool that traces value between wallets and cannot tell you one of them is sanctioned is missing
 * the single most consequential fact it could report. This is also the one enrichment where a false
 * negative matters more than latency, so the lists are cached for hours rather than days and a fetch
 * failure is stated in the report rather than swallowed: "not screened" and "screened clean" are very
 * different claims and must never look alike.
 *
 * The source is 0xB10C's parsed mirror, which tracks the published SDN list per chain. It is a
 * mirror, not the register itself, so a hit is a strong signal to verify against Treasury directly,
 * never a legal conclusion on its own.
 */
const BASE = 'https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/';

/** Chain slug to the SDN list that covers it. */
const LIST_FOR_CHAIN: Record<string, string> = {
  ethereum: 'ETH',
  base: 'ETH',
  arbitrum: 'ARB',
  optimism: 'ETH',
  polygon: 'ETH',
  gnosis: 'ETH',
  scroll: 'ETH',
  zksync: 'ETH',
  celo: 'ETH',
  unichain: 'ETH',
  linea: 'ETH',
  blast: 'ETH',
  bsc: 'BSC',
  avalanche: 'ETH',
  solana: 'SOL',
};

const TTL_SECONDS = 6 * 3600;

export interface SanctionsScreen {
  /** True when the address appears on the list covering its chain. */
  isSanctioned(chain: string, address: string): boolean;
  /** Lists that could not be fetched, so the report can say screening was incomplete. */
  readonly unavailable: string[];
  /** True when every list needed for the analysed chains was loaded. */
  readonly complete: boolean;
}

class Screen implements SanctionsScreen {
  constructor(
    private readonly entries: Map<string, Set<string>>,
    readonly unavailable: string[],
  ) {}

  isSanctioned(chain: string, address: string): boolean {
    const list = LIST_FOR_CHAIN[chain];
    if (!list) return false;
    const set = this.entries.get(list);
    if (!set) return false;
    // EVM lists are published checksummed; Solana is case sensitive base58.
    return set.has(chain === 'solana' ? address : address.toLowerCase());
  }

  get complete(): boolean {
    return this.unavailable.length === 0;
  }
}

export const NOT_SCREENED: SanctionsScreen = new Screen(new Map(), ['screening did not run']);

/** Loads only the lists the analysed chains actually need. */
export async function loadSanctions(
  chains: string[],
  deps: { cache: CacheStore; signal?: AbortSignal },
): Promise<SanctionsScreen> {
  const needed = [...new Set(chains.map((chain) => LIST_FOR_CHAIN[chain]).filter(Boolean))] as string[];
  const entries = new Map<string, Set<string>>();
  const unavailable: string[] = [];

  await Promise.all(
    needed.map(async (list) => {
      try {
        const addresses = await cached(deps.cache, `ofac:${list}`, TTL_SECONDS, () =>
          fetchJson<string[]>('ofac', `${BASE}sanctioned_addresses_${list}.json`, {
            timeoutMs: 15_000,
            retries: 1,
            signal: deps.signal,
          }),
        );
        entries.set(
          list,
          new Set(addresses.map((address) => (list === 'SOL' ? address : address.toLowerCase()))),
        );
      } catch {
        unavailable.push(list);
      }
    }),
  );

  return new Screen(entries, unavailable);
}
