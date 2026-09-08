import { fetchJson, qs } from '../util/http.js';
import { fromBaseUnits } from '../util/units.js';
import type { Transfer } from '../types.js';
import type { FetchContext } from './types.js';

/** Record shapes returned by the Etherscan-compatible `account` module (Etherscan V2, Blockscout v1). */
export interface V1Tx {
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  isError?: string;
  txreceipt_status?: string;
  contractAddress?: string;
  functionName?: string;
  methodId?: string;
  input?: string;
  type?: string;
  tokenSymbol?: string;
  tokenName?: string;
  tokenDecimal?: string;
  tokenID?: string;
}

export interface V1Envelope {
  status?: string;
  message?: string;
  result?: V1Tx[] | string;
}

export const ZERO = '0x0000000000000000000000000000000000000000';

export function lower(value: string | undefined): string {
  return (value ?? '').toLowerCase();
}

/** Etherscan reports "no records" as status 0 with an empty result; that is success, not an error. */
export function isEmptyEnvelope(env: V1Envelope): boolean {
  if (Array.isArray(env.result)) return env.result.length === 0;
  const text = typeof env.result === 'string' ? env.result : '';
  return /no transactions found|no records found/i.test(text) || /No transactions found/i.test(env.message ?? '');
}

export function envelopeError(env: V1Envelope): string | undefined {
  if (Array.isArray(env.result)) return undefined;
  if (isEmptyEnvelope(env)) return undefined;
  const text = typeof env.result === 'string' ? env.result : env.message ?? 'unexpected response';
  return text;
}

export async function getV1<T = V1Envelope>(
  provider: string,
  chainSlug: string,
  baseUrl: string,
  params: Record<string, string | number | undefined>,
  ctx: FetchContext,
): Promise<T> {
  const url = `${baseUrl}?${qs(params)}`;
  return fetchJson<T>(provider, url, {
    timeoutMs: 20_000,
    retries: 4,
    signal: ctx.signal,
    onAttempt: (info) => ctx.stats.record(provider, chainSlug, info),
  });
}

export interface NormalizeOptions {
  chain: string;
  nativeSymbol: string;
  nativeDecimals: number;
  since: number;
}

/** Native transfers and contract calls from `action=txlist`. */
export function normalizeNative(rows: V1Tx[], opts: NormalizeOptions): Transfer[] {
  const out: Transfer[] = [];
  rows.forEach((row, i) => {
    const ts = Number(row.timeStamp ?? 0);
    if (opts.since && ts && ts < opts.since) return;
    const raw = row.value ?? '0';
    const to = lower(row.to) || lower(row.contractAddress);
    if (!row.hash || !row.from || !to) return;
    out.push({
      chain: opts.chain,
      txHash: row.hash,
      ts,
      blockNumber: row.blockNumber ? Number(row.blockNumber) : undefined,
      from: lower(row.from),
      to,
      kind: 'native',
      asset: { kind: 'native', symbol: opts.nativeSymbol, decimals: opts.nativeDecimals },
      rawValue: raw,
      value: fromBaseUnits(raw, opts.nativeDecimals),
      success: row.isError !== '1' && row.txreceipt_status !== '0',
      payer: lower(row.from),
      index: i,
    });
  });
  return out;
}

/** Value moved by contracts, from `action=txlistinternal`. Exchange withdrawals land here. */
export function normalizeInternal(rows: V1Tx[], opts: NormalizeOptions): Transfer[] {
  const out: Transfer[] = [];
  rows.forEach((row, i) => {
    const ts = Number(row.timeStamp ?? 0);
    if (opts.since && ts && ts < opts.since) return;
    if (!row.hash || !row.from || !row.to) return;
    if (!row.value || row.value === '0') return;
    out.push({
      chain: opts.chain,
      txHash: row.hash,
      ts,
      blockNumber: row.blockNumber ? Number(row.blockNumber) : undefined,
      from: lower(row.from),
      to: lower(row.to),
      kind: 'internal',
      asset: { kind: 'native', symbol: opts.nativeSymbol, decimals: opts.nativeDecimals },
      rawValue: row.value,
      value: fromBaseUnits(row.value, opts.nativeDecimals),
      success: row.isError !== '1',
      index: 100_000 + i,
    });
  });
  return out;
}

/** ERC-20 movements from `action=tokentx`, ERC-721/1155 from `action=tokennfttx`. */
export function normalizeToken(rows: V1Tx[], opts: NormalizeOptions, nft = false): Transfer[] {
  const out: Transfer[] = [];
  rows.forEach((row, i) => {
    const ts = Number(row.timeStamp ?? 0);
    if (opts.since && ts && ts < opts.since) return;
    if (!row.hash || !row.from || !row.to) return;
    const decimals = nft ? 0 : Number(row.tokenDecimal ?? 18);
    const raw = nft ? row.tokenID ?? '1' : row.value ?? '0';
    out.push({
      chain: opts.chain,
      txHash: row.hash,
      ts,
      blockNumber: row.blockNumber ? Number(row.blockNumber) : undefined,
      from: lower(row.from),
      to: lower(row.to),
      kind: nft ? 'nft' : 'token',
      asset: {
        kind: nft ? 'nft' : 'token',
        symbol: row.tokenSymbol || undefined,
        address: lower(row.contractAddress) || undefined,
        decimals: Number.isFinite(decimals) ? decimals : 18,
      },
      rawValue: raw,
      value: nft ? 1 : fromBaseUnits(raw, Number.isFinite(decimals) ? decimals : 18),
      success: true,
      index: (nft ? 300_000 : 200_000) + i,
    });
  });
  return out;
}

/**
 * Trims a transfer sample to the budget.
 *
 * The newest activity is kept because it describes current behaviour, and the oldest inbound
 * transfers are kept unconditionally because the account's very first funding is the single most
 * discriminating linkage signal there is. Dropping it to save room would throw away the best
 * evidence in the sample.
 */
export function trim(
  transfers: Transfer[],
  max: number,
  preserveEarliest = 12,
): { transfers: Transfer[]; truncated: boolean } {
  const sorted = transfers.slice().sort((a, b) => b.ts - a.ts || a.index - b.index);
  if (sorted.length <= max) return { transfers: sorted, truncated: false };
  const oldestFirst = sorted.slice().reverse();
  const keep = new Set(sorted.slice(0, Math.max(0, max - preserveEarliest)));
  for (const transfer of oldestFirst.slice(0, preserveEarliest)) keep.add(transfer);
  return { transfers: sorted.filter((t) => keep.has(t)), truncated: true };
}

/** Removes duplicates produced by merging ascending and descending pages. */
export function dedupe(transfers: Transfer[]): Transfer[] {
  const seen = new Set<string>();
  const out: Transfer[] = [];
  for (const t of transfers) {
    const key = `${t.txHash}|${t.kind}|${t.from}|${t.to}|${t.rawValue}|${t.asset.address ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}
