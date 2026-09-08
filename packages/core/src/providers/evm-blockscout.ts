import { getChain } from '../chains.js';
import { ProviderError } from '../errors.js';
import { fetchJson } from '../util/http.js';
import { cached } from '../util/cache.js';
import { fromBaseUnits } from '../util/units.js';
import type { AccountFacts, AddressRef, ChainDescriptor, Transfer } from '../types.js';
import {
  dedupe,
  envelopeError,
  getV1,
  lower,
  normalizeInternal,
  normalizeNative,
  normalizeToken,
  trim,
  type NormalizeOptions,
  type V1Envelope,
  type V1Tx,
} from './evm-common.js';
import type { ChainProvider, CollectOptions, FetchContext, ProviderActivity } from './types.js';

/** Blockscout ships two APIs. v1 is Etherscan compatible; a few instances redirect it away. */
type ApiMode = 'v1' | 'v2';

const MODE_BY_HOST = new Map<string, ApiMode>();

interface V2Item {
  hash?: string;
  timestamp?: string;
  block_number?: number;
  value?: string;
  from?: { hash?: string; is_contract?: boolean };
  to?: { hash?: string; is_contract?: boolean };
  status?: string;
  result?: string;
  total?: { value?: string; decimals?: string; token_id?: string };
  token?: { address?: string; address_hash?: string; symbol?: string; decimals?: string; type?: string };
  transaction_hash?: string;
}

interface V2Page {
  items?: V2Item[];
  next_page_params?: Record<string, string | number> | null;
}

interface V2Address {
  hash?: string;
  is_contract?: boolean;
  creator_address_hash?: string;
  creation_transaction_hash?: string;
  creation_tx_hash?: string;
  ens_domain_name?: string;
  coin_balance?: string;
  name?: string;
  proxy_type?: string | null;
  implementations?: { address_hash?: string; name?: string }[];
}

function host(chain: ChainDescriptor): string {
  const override = process.env[`BRAID_BLOCKSCOUT_${chain.slug.toUpperCase()}`];
  return (override || chain.blockscout || '').replace(/\/$/, '');
}

/**
 * Keyless EVM history from a Blockscout instance.
 *
 * This is the default provider: it needs no credentials, which is what makes Braid usable the
 * moment it is cloned. It prefers the Etherscan-compatible v1 API because that endpoint paginates
 * cheaply, and falls back to the v2 REST API on instances where v1 redirects to a hosted explorer.
 */
export class BlockscoutProvider implements ChainProvider {
  readonly name = 'blockscout';
  readonly namespace = 'evm' as const;
  readonly priority = 10;

  supports(chain: ChainDescriptor): boolean {
    return chain.namespace === 'evm' && host(chain).length > 0;
  }

  /**
   * Decides which of the instance's two APIs to use, and remembers it only when the answer is real.
   *
   * A transient failure must never be cached here. The v2 REST API cannot page backwards, so an
   * instance downgraded to it loses the first-funding signals entirely, and a single rate limited
   * probe would otherwise cost every later analysis in the process that evidence. So a conclusive
   * answer is cached and anything else falls through to v1 optimistically: if v1 really is
   * unavailable the data calls will say so, with a warning attached to the report.
   */
  private async mode(chain: ChainDescriptor, ctx: FetchContext): Promise<ApiMode> {
    const base = host(chain);
    const known = MODE_BY_HOST.get(base);
    if (known) return known;
    try {
      const env = await getV1<V1Envelope>(
        this.name,
        chain.slug,
        `${base}/api`,
        { module: 'block', action: 'eth_block_number' },
        ctx,
      );
      const looksV1 = Boolean(env) && (typeof (env as Record<string, unknown>).result === 'string' || 'jsonrpc' in env);
      const keyRequired = typeof env.result === 'string' && /api key/i.test(env.result);
      if (looksV1 && !keyRequired) {
        MODE_BY_HOST.set(base, 'v1');
        return 'v1';
      }
      // A hosted explorer answering the compatibility endpoint with "invalid API key" is a settled
      // fact about the instance, not a hiccup, so it is worth remembering.
      if (keyRequired) {
        MODE_BY_HOST.set(base, 'v2');
        return 'v2';
      }
      return 'v1';
    } catch {
      ctx.stats.note(this.name, chain.slug, 'API probe failed; assuming the Etherscan-compatible API');
      return 'v1';
    }
  }

  async fetchFacts(ref: AddressRef, ctx: FetchContext): Promise<Partial<AccountFacts>> {
    const chain = getChain(ref.chain);
    const base = host(chain);
    if (!base) return {};
    const url = `${base}/api/v2/addresses/${ref.address}`;
    const info = await cached(ctx.cache, `bs:facts:${ref.key}`, ctx.cacheTtlSeconds, () =>
      fetchJson<V2Address>(this.name, url, {
        timeoutMs: 15_000,
        retries: 1,
        signal: ctx.signal,
        onAttempt: (attempt) => ctx.stats.record(this.name, chain.slug, attempt),
      }).catch(() => ({}) as V2Address),
    );
    const facts: Partial<AccountFacts> = {};
    // An EIP-7702 account has code, so explorers flag it as a contract. It is still an EOA with a
    // person behind it, and every signal that skips contracts must not skip it.
    const delegated = info.proxy_type === 'eip7702';
    if (delegated) {
      facts.delegated = true;
      facts.isContract = false;
      const implementation = info.implementations?.[0]?.address_hash;
      if (implementation) facts.delegateTo = lower(implementation);
    } else if (info.is_contract !== undefined) {
      facts.isContract = info.is_contract;
    }
    if (info.creator_address_hash) facts.creator = lower(info.creator_address_hash);
    const creation = info.creation_transaction_hash ?? info.creation_tx_hash;
    if (creation) facts.creationTx = creation;
    if (info.ens_domain_name) facts.name = info.ens_domain_name;
    if (info.coin_balance) facts.balance = fromBaseUnits(info.coin_balance, chain.nativeDecimals);
    return facts;
  }

  async fetchActivity(ref: AddressRef, options: CollectOptions, ctx: FetchContext): Promise<ProviderActivity> {
    const chain = getChain(ref.chain);
    const mode = await this.mode(chain, ctx);
    return mode === 'v1'
      ? fetchV1Activity(this.name, chain, `${host(chain)}/api`, {}, ref, options, ctx)
      : this.fetchV2Activity(chain, ref, options, ctx);
  }

  private async fetchV2Activity(
    chain: ChainDescriptor,
    ref: AddressRef,
    options: CollectOptions,
    ctx: FetchContext,
  ): Promise<ProviderActivity> {
    const base = host(chain);
    const warnings: string[] = [];
    const collected: Transfer[] = [];
    const payers = new Set<string>();

    const walk = async (path: string, map: (item: V2Item, i: number) => Transfer | undefined, budget: number) => {
      let next: Record<string, string | number> | null | undefined;
      let pulled = 0;
      for (let page = 0; page < 6 && pulled < budget; page += 1) {
        if (Date.now() >= ctx.deadline) {
          warnings.push(`${path} stopped early: time budget reached`);
          return true;
        }
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(next ?? {})) search.set(key, String(value));
        const url = `${base}/api/v2/addresses/${ref.address}/${path}${search.size ? `?${search}` : ''}`;
        let result: V2Page;
        try {
          result = await cached(ctx.cache, `bs2:${ref.key}:${path}:${search}`, ctx.cacheTtlSeconds, () =>
            fetchJson<V2Page>(this.name, url, {
              timeoutMs: 25_000,
              retries: 1,
              signal: ctx.signal,
              onAttempt: (attempt) => ctx.stats.record(this.name, chain.slug, attempt),
            }),
          );
        } catch (err) {
          warnings.push(`${path} unavailable on ${new URL(base).host}: ${(err as Error).message}`);
          return false;
        }
        const items = result.items ?? [];
        items.forEach((item, i) => {
          const transfer = map(item, pulled + i);
          if (!transfer) return;
          if (options.since && transfer.ts && transfer.ts < options.since) return;
          collected.push(transfer);
          if (transfer.payer) payers.add(transfer.payer);
        });
        pulled += items.length;
        next = result.next_page_params ?? null;
        if (!next || items.length === 0) return false;
      }
      return pulled >= budget;
    };

    const seconds = (value?: string) => (value ? Math.floor(new Date(value).getTime() / 1000) : 0);
    const nativeBudget = Math.ceil(options.maxTransfers * 0.6);
    const tokenBudget = Math.ceil(options.maxTransfers * 0.5);

    const truncatedNative = await walk(
      'transactions',
      (item, i) => {
        const from = lower(item.from?.hash);
        const to = lower(item.to?.hash);
        const hash = item.hash ?? item.transaction_hash;
        if (!from || !to || !hash) return undefined;
        const raw = item.value ?? '0';
        return {
          chain: chain.slug,
          txHash: hash,
          ts: seconds(item.timestamp),
          blockNumber: item.block_number,
          from,
          to,
          kind: 'native',
          asset: { kind: 'native', symbol: chain.nativeSymbol, decimals: chain.nativeDecimals },
          rawValue: raw,
          value: fromBaseUnits(raw, chain.nativeDecimals),
          success: (item.status ?? item.result ?? 'ok') !== 'error',
          payer: from,
          index: i,
        } satisfies Transfer;
      },
      nativeBudget,
    );

    const truncatedToken = await walk(
      'token-transfers',
      (item, i) => {
        const from = lower(item.from?.hash);
        const to = lower(item.to?.hash);
        const hash = item.transaction_hash ?? item.hash;
        if (!from || !to || !hash) return undefined;
        const isNft = (item.token?.type ?? '').includes('721') || (item.token?.type ?? '').includes('1155');
        if (isNft && !options.includeNft) return undefined;
        const decimals = Number(item.total?.decimals ?? item.token?.decimals ?? (isNft ? 0 : 18));
        const raw = item.total?.value ?? item.total?.token_id ?? '0';
        return {
          chain: chain.slug,
          txHash: hash,
          ts: seconds(item.timestamp),
          blockNumber: item.block_number,
          from,
          to,
          kind: isNft ? 'nft' : 'token',
          asset: {
            kind: isNft ? 'nft' : 'token',
            symbol: item.token?.symbol,
            address: lower(item.token?.address ?? item.token?.address_hash),
            decimals: Number.isFinite(decimals) ? decimals : 18,
          },
          rawValue: raw,
          value: isNft ? 1 : fromBaseUnits(raw, Number.isFinite(decimals) ? decimals : 18),
          success: true,
          index: 200_000 + i,
        } satisfies Transfer;
      },
      tokenBudget,
    );

    const { transfers, truncated } = trim(dedupe(collected), options.maxTransfers);
    return {
      transfers,
      payers: [...payers],
      truncated: truncated || truncatedNative || truncatedToken,
      // The v2 REST API pages newest first only, so this walk can never prove it saw the account's
      // opening transaction. The first-funding signals stay switched off for it.
      reachedGenesis: false,
      warnings,
    };
  }
}

/**
 * Shared Etherscan-compatible walk, used by both Blockscout v1 and Etherscan V2.
 *
 * Each dataset is pulled twice: newest first for current behaviour and oldest first for the
 * account's opening transactions, which is where the first-funder evidence lives.
 */
export async function fetchV1Activity(
  provider: string,
  chain: ChainDescriptor,
  baseUrl: string,
  extraParams: Record<string, string | number>,
  ref: AddressRef,
  options: CollectOptions,
  ctx: FetchContext,
): Promise<ProviderActivity> {
  const warnings: string[] = [];
  const norm: NormalizeOptions = {
    chain: chain.slug,
    nativeSymbol: chain.nativeSymbol,
    nativeDecimals: chain.nativeDecimals,
    since: options.since,
  };
  const collected: Transfer[] = [];
  const payers = new Set<string>();
  const facts: Partial<AccountFacts> = {};
  let truncated = false;
  let reachedGenesis = false;
  let succeeded = 0;
  let failed = 0;

  const actions: { action: string; normalize: (rows: V1Tx[]) => Transfer[]; share: number }[] = [
    { action: 'txlist', normalize: (rows) => normalizeNative(rows, norm), share: 0.5 },
    { action: 'tokentx', normalize: (rows) => normalizeToken(rows, norm), share: 0.35 },
    { action: 'txlistinternal', normalize: (rows) => normalizeInternal(rows, norm), share: 0.2 },
  ];
  if (options.includeNft) {
    actions.push({ action: 'tokennfttx', normalize: (rows) => normalizeToken(rows, norm, true), share: 0.15 });
  }

  for (const { action, normalize, share } of actions) {
    const budget = Math.max(20, Math.ceil(options.maxTransfers * share));
    const passes: { sort: 'desc' | 'asc'; offset: number }[] = [
      { sort: 'desc', offset: Math.min(budget, 1000) },
      { sort: 'asc', offset: Math.min(25, budget) },
    ];
    for (const pass of passes) {
      if (Date.now() >= ctx.deadline) {
        warnings.push(`stopped before ${action} (${pass.sort}): time budget reached`);
        truncated = true;
        break;
      }
      const params = {
        module: 'account',
        action,
        address: ref.address,
        startblock: 0,
        endblock: 99_999_999,
        page: 1,
        offset: pass.offset,
        sort: pass.sort,
        ...extraParams,
      };
      const cacheKey = `v1:${provider}:${chain.slug}:${ref.normalized}:${action}:${pass.sort}:${pass.offset}`;
      try {
        const env = await cached(ctx.cache, cacheKey, ctx.cacheTtlSeconds, () =>
          getV1<V1Envelope>(provider, chain.slug, baseUrl, params, ctx),
        );
        const error = envelopeError(env);
        if (error) {
          // An envelope error is a settled answer about this dataset (an unsupported action, a
          // missing key), so it applies to every pass and there is nothing to retry.
          warnings.push(`${action} unavailable: ${error}`);
          failed += 1;
          break;
        }
        succeeded += 1;
        const rows = Array.isArray(env.result) ? env.result : [];
        if (rows.length >= pass.offset) truncated = true;
        // The ascending pass returns the oldest records the explorer holds, so completing it for
        // the native transaction list means the account's first transaction is in the sample.
        if (pass.sort === 'asc' && action === 'txlist') reachedGenesis = true;
        for (const transfer of normalize(rows)) {
          collected.push(transfer);
          if (transfer.payer) payers.add(transfer.payer);
        }
        if (action === 'txlist') {
          for (const row of rows) {
            if (!row.to && row.contractAddress) {
              facts.creationTx = row.hash;
            }
          }
        }
        // An empty descending page means the account has no records of this kind at all, so the
        // ascending pass has nothing to add.
        if (rows.length === 0) break;
      } catch (err) {
        // A transient failure on one pass must not cancel the other. The ascending pass is the
        // cheap one and it is the only source of first-funding evidence, so it always gets its own
        // attempt rather than inheriting a rate limit from the descending pass.
        warnings.push(`${action} (${pass.sort}) failed: ${(err as Error).message}`);
        failed += 1;
        continue;
      }
    }
  }

  // Returning an empty result after every request failed would read as "this address has no
  // history", which is the most misleading thing a linkage tool can say. Fail instead, so the
  // provider chain can try the next provider and, if none succeed, the report carries the reason.
  if (succeeded === 0 && failed > 0) {
    throw new ProviderError(provider, `no dataset could be read from ${new URL(baseUrl).host}: ${warnings[0] ?? 'unknown'}`);
  }

  const result = trim(dedupe(collected), options.maxTransfers);
  return {
    transfers: result.transfers,
    payers: [...payers],
    truncated: truncated || result.truncated,
    reachedGenesis,
    warnings,
    facts,
  };
}
