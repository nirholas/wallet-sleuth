import type { ChainDescriptor, Namespace } from './types.js';

/**
 * The chain registry.
 *
 * `blockscout` hosts are keyless and are what Wallet Sleuth uses out of the box. `etherscanV2` marks
 * chains the Etherscan V2 multichain API covers, which Wallet Sleuth prefers when a key is configured
 * because it is faster and paginates further.
 */
const CHAIN_LIST: ChainDescriptor[] = [
  {
    slug: 'ethereum',
    name: 'Ethereum',
    namespace: 'evm',
    evmChainId: 1,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://etherscan.io/address/',
    explorerTx: 'https://etherscan.io/tx/',
    blockscout: 'https://eth.blockscout.com',
    etherscanV2: true,
    default: true,
  },
  {
    slug: 'base',
    name: 'Base',
    namespace: 'evm',
    evmChainId: 8453,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://basescan.org/address/',
    explorerTx: 'https://basescan.org/tx/',
    blockscout: 'https://base.blockscout.com',
    etherscanV2: true,
    default: true,
  },
  {
    slug: 'arbitrum',
    name: 'Arbitrum One',
    namespace: 'evm',
    evmChainId: 42161,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://arbiscan.io/address/',
    explorerTx: 'https://arbiscan.io/tx/',
    blockscout: 'https://arbitrum.blockscout.com',
    etherscanV2: true,
    default: true,
  },
  {
    slug: 'optimism',
    name: 'OP Mainnet',
    namespace: 'evm',
    evmChainId: 10,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://optimistic.etherscan.io/address/',
    explorerTx: 'https://optimistic.etherscan.io/tx/',
    blockscout: 'https://optimism.blockscout.com',
    etherscanV2: true,
    default: true,
  },
  {
    slug: 'polygon',
    name: 'Polygon PoS',
    namespace: 'evm',
    evmChainId: 137,
    nativeSymbol: 'POL',
    nativeDecimals: 18,
    coingeckoId: 'matic-network',
    explorerAddress: 'https://polygonscan.com/address/',
    explorerTx: 'https://polygonscan.com/tx/',
    blockscout: 'https://polygon.blockscout.com',
    etherscanV2: true,
    default: true,
  },
  {
    slug: 'gnosis',
    name: 'Gnosis',
    namespace: 'evm',
    evmChainId: 100,
    nativeSymbol: 'xDAI',
    nativeDecimals: 18,
    coingeckoId: 'xdai',
    explorerAddress: 'https://gnosisscan.io/address/',
    explorerTx: 'https://gnosisscan.io/tx/',
    blockscout: 'https://gnosis.blockscout.com',
    etherscanV2: true,
  },
  {
    slug: 'scroll',
    name: 'Scroll',
    namespace: 'evm',
    evmChainId: 534352,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://scrollscan.com/address/',
    explorerTx: 'https://scrollscan.com/tx/',
    blockscout: 'https://scroll.blockscout.com',
    etherscanV2: true,
  },
  {
    slug: 'zksync',
    name: 'ZKsync Era',
    namespace: 'evm',
    evmChainId: 324,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://era.zksync.network/address/',
    explorerTx: 'https://era.zksync.network/tx/',
    blockscout: 'https://zksync.blockscout.com',
    etherscanV2: true,
  },
  {
    slug: 'celo',
    name: 'Celo',
    namespace: 'evm',
    evmChainId: 42220,
    nativeSymbol: 'CELO',
    nativeDecimals: 18,
    coingeckoId: 'celo',
    explorerAddress: 'https://celoscan.io/address/',
    explorerTx: 'https://celoscan.io/tx/',
    blockscout: 'https://celo.blockscout.com',
    etherscanV2: true,
  },
  {
    slug: 'unichain',
    name: 'Unichain',
    namespace: 'evm',
    evmChainId: 130,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://uniscan.xyz/address/',
    explorerTx: 'https://uniscan.xyz/tx/',
    blockscout: 'https://unichain.blockscout.com',
    etherscanV2: true,
  },
  {
    slug: 'bsc',
    name: 'BNB Smart Chain',
    namespace: 'evm',
    evmChainId: 56,
    nativeSymbol: 'BNB',
    nativeDecimals: 18,
    coingeckoId: 'binancecoin',
    explorerAddress: 'https://bscscan.com/address/',
    explorerTx: 'https://bscscan.com/tx/',
    etherscanV2: true,
  },
  {
    slug: 'avalanche',
    name: 'Avalanche C-Chain',
    namespace: 'evm',
    evmChainId: 43114,
    nativeSymbol: 'AVAX',
    nativeDecimals: 18,
    coingeckoId: 'avalanche-2',
    explorerAddress: 'https://snowscan.xyz/address/',
    explorerTx: 'https://snowscan.xyz/tx/',
    etherscanV2: true,
  },
  {
    slug: 'linea',
    name: 'Linea',
    namespace: 'evm',
    evmChainId: 59144,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://lineascan.build/address/',
    explorerTx: 'https://lineascan.build/tx/',
    etherscanV2: true,
  },
  {
    slug: 'blast',
    name: 'Blast',
    namespace: 'evm',
    evmChainId: 81457,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    coingeckoId: 'ethereum',
    explorerAddress: 'https://blastscan.io/address/',
    explorerTx: 'https://blastscan.io/tx/',
    etherscanV2: true,
  },
  {
    slug: 'solana',
    name: 'Solana',
    namespace: 'solana',
    nativeSymbol: 'SOL',
    nativeDecimals: 9,
    coingeckoId: 'solana',
    explorerAddress: 'https://solscan.io/account/',
    explorerTx: 'https://solscan.io/tx/',
    default: true,
  },
];

const BY_SLUG = new Map<string, ChainDescriptor>(CHAIN_LIST.map((c) => [c.slug, c]));
const BY_EVM_ID = new Map<number, ChainDescriptor>(
  CHAIN_LIST.filter((c) => c.evmChainId !== undefined).map((c) => [c.evmChainId as number, c]),
);

/** Aliases callers reasonably type. */
const ALIASES: Record<string, string> = {
  eth: 'ethereum',
  mainnet: 'ethereum',
  'eip155:1': 'ethereum',
  matic: 'polygon',
  op: 'optimism',
  arb: 'arbitrum',
  arbitrumone: 'arbitrum',
  bnb: 'bsc',
  binance: 'bsc',
  avax: 'avalanche',
  era: 'zksync',
  sol: 'solana',
  'solana:mainnet': 'solana',
  xdai: 'gnosis',
};

export const chains = CHAIN_LIST;

export function listChains(): ChainDescriptor[] {
  return CHAIN_LIST.slice();
}

export function defaultChains(namespace?: Namespace): ChainDescriptor[] {
  return CHAIN_LIST.filter((c) => c.default && (!namespace || c.namespace === namespace));
}

export function resolveChain(slugOrAlias: string): ChainDescriptor | undefined {
  const key = slugOrAlias.trim().toLowerCase();
  const alias = ALIASES[key];
  return BY_SLUG.get(alias ?? key) ?? undefined;
}

export function chainByEvmId(id: number): ChainDescriptor | undefined {
  return BY_EVM_ID.get(id);
}

export function getChain(slug: string): ChainDescriptor {
  const chain = resolveChain(slug);
  if (!chain) throw new Error(`unknown chain: ${slug}`);
  return chain;
}

export function addressUrl(chainSlug: string, address: string): string {
  const chain = resolveChain(chainSlug);
  return chain ? `${chain.explorerAddress}${address}` : address;
}

export function txUrl(chainSlug: string, hash: string): string {
  const chain = resolveChain(chainSlug);
  return chain ? `${chain.explorerTx}${hash}` : hash;
}
