import type { ActivityBundle, AddressRef, Transfer } from '../src/types.js';
import { makeRef } from '../src/address.js';

/**
 * Synthetic activity used to exercise the signals deterministically.
 *
 * These are inputs to pure functions, not stand-ins for chain data: nothing here is ever served to a
 * user or presented as a real transaction. The live provider behaviour is covered separately in
 * `test/live`, which runs against real endpoints when BRAID_LIVE is set.
 */
export const A = '0x1111111111111111111111111111111111111111';
export const B = '0x2222222222222222222222222222222222222222';
export const FUNDER = '0x3333333333333333333333333333333333333333';
export const SHARED = '0x4444444444444444444444444444444444444444';
export const EXCHANGE = '0x28c6c06298d514db089934071355e5743bf21d60';

export const DAY = 86_400;
export const T0 = 1_700_000_000;

export function transfer(partial: Partial<Transfer> & Pick<Transfer, 'from' | 'to'>): Transfer {
  // Addresses are lowercased last, because the engine compares normalized forms everywhere and a
  // fixture that leaks a checksummed address silently stops matching.
  return {
    chain: 'ethereum',
    txHash: `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`,
    ts: T0,
    kind: 'native',
    asset: { kind: 'native', symbol: 'ETH', decimals: 18 },
    rawValue: '1000000000000000000',
    value: 1,
    success: true,
    index: 0,
    ...partial,
    from: partial.from.toLowerCase(),
    to: partial.to.toLowerCase(),
  };
}

export function bundle(
  address: string,
  transfers: Transfer[],
  overrides: Partial<ActivityBundle> = {},
): ActivityBundle {
  const ref: AddressRef = makeRef('ethereum', address);
  return {
    ref,
    facts: { key: ref.key, chain: ref.chain, address: ref.address },
    transfers,
    payers: [],
    truncated: false,
    reachedGenesis: true,
    warnings: [],
    fetchMs: 1,
    providers: ['test'],
    ...overrides,
  };
}

export function solanaBundle(
  address: string,
  transfers: Transfer[],
  overrides: Partial<ActivityBundle> = {},
): ActivityBundle {
  const ref: AddressRef = makeRef('solana', address);
  return {
    ref,
    facts: { key: ref.key, chain: ref.chain, address: ref.address },
    transfers: transfers.map((t) => ({ ...t, chain: 'solana' })),
    payers: [],
    truncated: false,
    reachedGenesis: true,
    warnings: [],
    fetchMs: 1,
    providers: ['test'],
    ...overrides,
  };
}
