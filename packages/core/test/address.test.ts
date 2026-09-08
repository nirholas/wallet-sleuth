import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';
import {
  detectNamespace,
  isEvmAddress,
  isSolanaAddress,
  makeRef,
  parseAddressList,
  parseKey,
  shortAddress,
  toChecksumAddress,
} from '../src/address.js';

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const SOL = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

describe('address recognition', () => {
  it('accepts a well formed EVM address in any case', () => {
    expect(isEvmAddress(VITALIK)).toBe(true);
    expect(isEvmAddress(VITALIK.toLowerCase())).toBe(true);
    expect(isEvmAddress(` ${VITALIK} `)).toBe(true);
  });

  it('rejects near misses rather than guessing', () => {
    expect(isEvmAddress(VITALIK.slice(0, 41))).toBe(false);
    expect(isEvmAddress(`${VITALIK}00`)).toBe(false);
    expect(isEvmAddress('0xZZZa6BF26964aF9D7eEd9e03E53415D37aA96045')).toBe(false);
  });

  it('accepts a 32 byte base58 Solana address and rejects other base58', () => {
    expect(isSolanaAddress(SOL)).toBe(true);
    // Valid base58 in the right length range, but 31 bytes once decoded rather than 32. Length
    // alone is not a sufficient check, which is why the implementation decodes before deciding.
    const thirtyOne = bs58.encode(Uint8Array.from({ length: 31 }, (_, i) => i + 40));
    expect(thirtyOne.length).toBeGreaterThanOrEqual(32);
    expect(isSolanaAddress(thirtyOne)).toBe(false);
    // Base58 excludes 0, O, I and l precisely to avoid this class of typo.
    expect(isSolanaAddress('0WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')).toBe(false);
  });

  it('names the namespace it detected', () => {
    expect(detectNamespace(VITALIK)).toBe('evm');
    expect(detectNamespace(SOL)).toBe('solana');
    expect(detectNamespace('hello')).toBeUndefined();
  });
});

describe('EIP-55 checksum', () => {
  it('reproduces the reference vectors', () => {
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
    expect(toChecksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toBe(
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    );
    expect(toChecksumAddress('0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb')).toBe(
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    );
  });

  it('is idempotent on an already checksummed address', () => {
    expect(toChecksumAddress(VITALIK)).toBe(VITALIK);
  });
});

describe('parsing an input list', () => {
  it('fans a bare EVM address across the requested EVM chains', () => {
    const { refs } = parseAddressList([VITALIK], ['ethereum', 'base']);
    expect(refs.map((ref) => ref.chain).sort()).toEqual(['base', 'ethereum']);
    expect(refs.every((ref) => ref.normalized === VITALIK.toLowerCase())).toBe(true);
    expect(refs.every((ref) => ref.explicit)).toBe(true);
  });

  it('marks inferred chain guesses as not explicit when no chain was requested', () => {
    const { refs } = parseAddressList([VITALIK]);
    expect(refs.length).toBeGreaterThan(1);
    expect(refs.every((ref) => ref.explicit)).toBe(false);
  });

  it('honours a chain prefix and does not fan out', () => {
    const { refs } = parseAddressList([`base:${VITALIK}`], ['ethereum', 'base', 'arbitrum']);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.chain).toBe('base');
  });

  it('resolves chain aliases', () => {
    expect(parseAddressList([`eth:${VITALIK}`]).refs[0]?.chain).toBe('ethereum');
    expect(parseAddressList([`sol:${SOL}`]).refs[0]?.chain).toBe('solana');
  });

  it('splits on whitespace, commas and semicolons', () => {
    const { refs } = parseAddressList(`${VITALIK}, ${SOL};\n ${VITALIK}`, ['ethereum']);
    expect(refs).toHaveLength(2);
  });

  it('deduplicates the same address supplied twice', () => {
    const { refs } = parseAddressList([SOL, SOL, SOL]);
    expect(refs).toHaveLength(1);
  });

  it('reports why an entry was rejected instead of dropping it silently', () => {
    const { refs, rejected } = parseAddressList(['not-an-address', SOL]);
    expect(refs).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.input).toBe('not-an-address');
    expect(rejected[0]?.reason).toMatch(/EVM|Solana/);
  });

  it('never routes a Solana address onto an EVM chain', () => {
    const { refs } = parseAddressList([SOL], ['ethereum', 'base']);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.chain).toBe('solana');
  });
});

describe('keys', () => {
  it('round trips through parseKey', () => {
    const ref = makeRef('ethereum', VITALIK);
    expect(parseKey(ref.key)).toEqual({ chain: 'ethereum', normalized: VITALIK.toLowerCase() });
  });

  it('keeps Solana keys case sensitive because base58 is', () => {
    const ref = makeRef('solana', SOL);
    expect(ref.normalized).toBe(SOL);
    expect(ref.key).toBe(`solana:${SOL}`);
  });

  it('shortens for display without losing the ends', () => {
    expect(shortAddress(VITALIK)).toBe('0xd8dA…6045');
    expect(shortAddress('short')).toBe('short');
  });
});
