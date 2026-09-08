import { getChain } from '../chains.js';
import type { ChainDescriptor } from '../types.js';
import { BlockscoutProvider } from './evm-blockscout.js';
import { EtherscanProvider } from './evm-etherscan.js';
import { SolanaRpcProvider } from './solana-rpc.js';
import type { ChainProvider } from './types.js';

/**
 * Assembles the provider chain.
 *
 * Order is by priority, so a configured Etherscan key is tried before the keyless Blockscout
 * instance, and collection falls through to the next provider when one is unavailable. Braid never
 * substitutes synthetic data for a failed provider: an address whose providers all fail is reported
 * with the failure attached.
 */
export function buildProviders(): ChainProvider[] {
  const providers: ChainProvider[] = [new BlockscoutProvider(), new SolanaRpcProvider()];
  const etherscan = EtherscanProvider.fromEnv();
  if (etherscan) providers.push(etherscan);
  return providers.sort((a, b) => b.priority - a.priority);
}

export function providersFor(providers: ChainProvider[], chainSlug: string): ChainProvider[] {
  const chain: ChainDescriptor = getChain(chainSlug);
  return providers.filter((provider) => provider.supports(chain));
}

export { BlockscoutProvider, EtherscanProvider, SolanaRpcProvider };
