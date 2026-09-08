import { keccak_256 } from '@noble/hashes/sha3';
import bs58 from 'bs58';
import { defaultChains, resolveChain } from './chains.js';
import { InvalidInputError } from './errors.js';
import type { AddressRef, Namespace } from './types.js';

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** EIP-55 checksum. Returns the mixed-case form of a 0x address. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const hash = Buffer.from(keccak_256(new TextEncoder().encode(lower))).toString('hex');
  let out = '0x';
  for (let i = 0; i < lower.length; i += 1) {
    const char = lower[i] as string;
    const nibble = parseInt(hash[i] as string, 16);
    out += nibble >= 8 ? char.toUpperCase() : char;
  }
  return out;
}

export function isEvmAddress(value: string): boolean {
  return EVM_RE.test(value.trim());
}

export function isSolanaAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!BASE58_RE.test(trimmed)) return false;
  try {
    return bs58.decode(trimmed).length === 32;
  } catch {
    return false;
  }
}

export function detectNamespace(value: string): Namespace | undefined {
  if (isEvmAddress(value)) return 'evm';
  if (isSolanaAddress(value)) return 'solana';
  return undefined;
}

export function addressKey(chain: string, normalized: string): string {
  return `${chain}:${normalized}`;
}

/** Split an address key back into its parts. */
export function parseKey(key: string): { chain: string; normalized: string } {
  const idx = key.indexOf(':');
  if (idx < 0) throw new InvalidInputError(`malformed address key: ${key}`);
  return { chain: key.slice(0, idx), normalized: key.slice(idx + 1) };
}

export function makeRef(
  chainSlug: string,
  address: string,
  input = address,
  explicit = true,
): AddressRef {
  const chain = resolveChain(chainSlug);
  if (!chain) throw new InvalidInputError(`unknown chain: ${chainSlug}`);
  if (chain.namespace === 'evm') {
    if (!isEvmAddress(address)) throw new InvalidInputError(`not an EVM address: ${address}`);
    const normalized = address.trim().toLowerCase();
    return {
      key: addressKey(chain.slug, normalized),
      chain: chain.slug,
      namespace: 'evm',
      address: toChecksumAddress(normalized),
      normalized,
      input,
      explicit,
    };
  }
  if (!isSolanaAddress(address)) throw new InvalidInputError(`not a Solana address: ${address}`);
  const normalized = address.trim();
  return {
    key: addressKey(chain.slug, normalized),
    chain: chain.slug,
    namespace: 'solana',
    address: normalized,
    normalized,
    input,
    explicit,
  };
}

export interface ParsedInput {
  refs: AddressRef[];
  rejected: { input: string; reason: string }[];
}

/**
 * Turn free-form user input into chain-qualified references.
 *
 * Accepts one address per line, comma or whitespace separated, with an optional `chain:` prefix
 * (`base:0xabc…`, `solana:9Wz…`). A bare EVM address expands to every requested EVM chain, because
 * the same private key controls the same address on all of them and linkage often crosses chains.
 */
export function parseAddressList(input: string | string[], chainSlugs?: string[]): ParsedInput {
  const raw = Array.isArray(input) ? input : input.split(/[\s,;]+/);
  const requested = (chainSlugs ?? []).map((slug) => {
    const chain = resolveChain(slug);
    if (!chain) throw new InvalidInputError(`unknown chain: ${slug}`);
    return chain;
  });
  const evmTargets = requested.filter((c) => c.namespace === 'evm');
  const evmChains = evmTargets.length > 0 ? evmTargets : defaultChains('evm');

  const refs: AddressRef[] = [];
  const rejected: { input: string; reason: string }[] = [];
  const seen = new Set<string>();

  const push = (ref: AddressRef) => {
    if (seen.has(ref.key)) return;
    seen.add(ref.key);
    refs.push(ref);
  };

  for (const entry of raw) {
    const token = entry.trim();
    if (!token) continue;

    const colon = token.lastIndexOf(':');
    if (colon > 0) {
      const prefix = token.slice(0, colon);
      const rest = token.slice(colon + 1);
      const chain = resolveChain(prefix);
      if (chain) {
        try {
          push(makeRef(chain.slug, rest, token));
        } catch (err) {
          rejected.push({ input: token, reason: (err as Error).message });
        }
        continue;
      }
    }

    const namespace = detectNamespace(token);
    if (namespace === 'solana') {
      push(makeRef('solana', token, token));
      continue;
    }
    if (namespace === 'evm') {
      for (const chain of evmChains) push(makeRef(chain.slug, token, token, evmTargets.length > 0));
      continue;
    }
    rejected.push({
      input: token,
      reason: 'not a recognizable EVM (0x + 40 hex) or Solana (base58, 32 bytes) address',
    });
  }

  return { refs, rejected };
}

/** Human-friendly short form, e.g. `0xd8dA…6045`. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address;
  return `${address.slice(0, lead)}…${address.slice(-tail)}`;
}
