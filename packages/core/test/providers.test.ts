import { describe, expect, it } from 'vitest';
import txlist from './recorded/blockscout-txlist.json' with { type: 'json' };
import tokentx from './recorded/blockscout-tokentx.json' with { type: 'json' };
import solanaTx from './recorded/solana-spl-transfer.json' with { type: 'json' };
import {
  dedupe,
  envelopeError,
  isEmptyEnvelope,
  normalizeInternal,
  normalizeNative,
  normalizeToken,
  trim,
  type NormalizeOptions,
  type V1Envelope,
  type V1Tx,
} from '../src/providers/evm-common.js';
import { extractTransfers, isRetryable, parseBatchLimit } from '../src/providers/solana-rpc.js';
import type { Transfer } from '../src/types.js';

/**
 * These fixtures are real responses recorded from the public endpoints Braid uses by default.
 * Normalisation is where a provider's shape becomes Braid's shape, and it is exactly the layer that
 * breaks silently when an upstream changes a field name, so it is pinned against real bytes.
 */
const OPTIONS: NormalizeOptions = {
  chain: 'ethereum',
  nativeSymbol: 'ETH',
  nativeDecimals: 18,
  since: 0,
};

describe('Etherscan-compatible normalisation', () => {
  it('turns a recorded txlist page into native transfers', () => {
    const rows = (txlist as unknown as { result: V1Tx[] }).result;
    const transfers = normalizeNative(rows, OPTIONS);
    expect(transfers.length).toBe(rows.length);
    for (const transfer of transfers) {
      expect(transfer.chain).toBe('ethereum');
      expect(transfer.from).toMatch(/^0x[0-9a-f]{40}$/);
      expect(transfer.to).toMatch(/^0x[0-9a-f]{40}$/);
      expect(transfer.txHash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(transfer.ts).toBeGreaterThan(1_400_000_000);
      expect(transfer.kind).toBe('native');
      expect(Number.isFinite(transfer.value)).toBe(true);
    }
  });

  it('lowercases addresses so comparisons never depend on checksum casing', () => {
    const transfers = normalizeNative((txlist as unknown as { result: V1Tx[] }).result, OPTIONS);
    expect(transfers.every((t) => t.from === t.from.toLowerCase())).toBe(true);
  });

  it('reads the token contract, symbol and decimals from a recorded tokentx page', () => {
    const transfers = normalizeToken((tokentx as unknown as { result: V1Tx[] }).result, OPTIONS);
    expect(transfers.length).toBeGreaterThan(0);
    for (const transfer of transfers) {
      expect(transfer.kind).toBe('token');
      expect(transfer.asset.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(Number.isFinite(transfer.asset.decimals)).toBe(true);
    }
  });

  it('honours the lookback cutoff', () => {
    const rows = (txlist as unknown as { result: V1Tx[] }).result;
    const newest = Math.max(...rows.map((row) => Number(row.timeStamp)));
    expect(normalizeNative(rows, { ...OPTIONS, since: newest + 1 })).toHaveLength(0);
  });

  it('marks a reverted transaction as unsuccessful rather than dropping it', () => {
    const failed: V1Tx[] = [
      {
        hash: '0x' + 'a'.repeat(64),
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '1000',
        timeStamp: '1700000000',
        isError: '1',
      },
    ];
    const [transfer] = normalizeNative(failed, OPTIONS);
    expect(transfer?.success).toBe(false);
  });

  it('ignores zero value internal transfers, which carry no flow information', () => {
    const rows: V1Tx[] = [
      {
        hash: '0x' + 'b'.repeat(64),
        from: '0x1111111111111111111111111111111111111111',
        to: '0x2222222222222222222222222222222222222222',
        value: '0',
        timeStamp: '1700000000',
      },
    ];
    expect(normalizeInternal(rows, OPTIONS)).toHaveLength(0);
  });
});

describe('envelope handling', () => {
  it('treats "no transactions found" as an empty result, not an error', () => {
    const env: V1Envelope = { status: '0', message: 'No transactions found', result: 'No transactions found' };
    expect(isEmptyEnvelope(env)).toBe(true);
    expect(envelopeError(env)).toBeUndefined();
  });

  it('surfaces a real API error so it reaches the report', () => {
    const env: V1Envelope = { status: '0', message: 'NOTOK', result: 'Missing/Invalid API Key' };
    expect(envelopeError(env)).toBe('Missing/Invalid API Key');
  });
});

describe('trim and dedupe', () => {
  const make = (ts: number, i: number): Transfer => ({
    chain: 'ethereum',
    txHash: `0x${String(i).padStart(64, '0')}`,
    ts,
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    kind: 'native',
    asset: { kind: 'native', symbol: 'ETH', decimals: 18 },
    rawValue: '1',
    value: 1,
    success: true,
    index: i,
  });

  it('keeps the oldest transfers even when the budget forces a trim', () => {
    const transfers = Array.from({ length: 100 }, (_, i) => make(1_000_000 + i, i));
    const { transfers: kept, truncated } = trim(transfers, 20, 5);
    expect(truncated).toBe(true);
    expect(kept).toHaveLength(20);
    // The five oldest survive: they are where the first-funding evidence lives.
    const oldestKept = kept.filter((t) => t.ts < 1_000_005);
    expect(oldestKept).toHaveLength(5);
    // And the newest are kept too.
    expect(kept.some((t) => t.ts === 1_000_099)).toBe(true);
  });

  it('does not report truncation when everything fits', () => {
    const { truncated } = trim([make(1, 0), make(2, 1)], 10);
    expect(truncated).toBe(false);
  });

  it('removes duplicates produced by merging ascending and descending pages', () => {
    const one = make(5, 1);
    expect(dedupe([one, { ...one }, make(6, 2)])).toHaveLength(2);
  });
});

describe('Solana transaction decoding', () => {
  it('resolves an SPL transfer to the owning wallets, not the token accounts', () => {
    const tx = solanaTx as never;
    const { transfers, feePayer } = extractTransfers(tx, 'sig', 'solana');
    expect(feePayer).toBeTruthy();
    const token = transfers.filter((transfer) => transfer.kind === 'token');
    expect(token.length).toBeGreaterThan(0);
    for (const transfer of token) {
      // Owners are wallets; if the mapping failed these would be the token account addresses.
      expect(transfer.from).not.toBe(transfer.to);
      expect(transfer.asset.address).toBeTruthy();
      expect(transfer.payer).toBe(feePayer);
    }
  });

  it('attributes every transfer to the fee payer that signed it', () => {
    const { transfers, feePayer } = extractTransfers(solanaTx as never, 'sig', 'solana');
    expect(transfers.every((transfer) => transfer.payer === feePayer)).toBe(true);
  });
});

describe('public RPC quirks', () => {
  it('reads an undeclared batch limit out of an endpoint error', () => {
    expect(
      parseBatchLimit(
        "Maximum number of 'getTransaction' calls in a batch request is 1. To increase limits, get a token",
      ),
    ).toBe(1);
    expect(parseBatchLimit('some unrelated failure')).toBeUndefined();
    expect(parseBatchLimit(undefined)).toBeUndefined();
  });

  it('distinguishes a throttled call from a transaction that does not exist', () => {
    expect(isRetryable({ code: 429, message: 'Too many requests for a specific RPC call' })).toBe(true);
    expect(isRetryable({ code: -32005, message: 'rate limit' })).toBe(true);
    expect(isRetryable({ code: -32602, message: 'Invalid param: not a valid signature' })).toBe(false);
  });
});
