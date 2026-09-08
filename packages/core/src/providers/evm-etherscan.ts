import { getChain } from '../chains.js';
import { cached } from '../util/cache.js';
import type { AccountFacts, AddressRef, ChainDescriptor } from '../types.js';
import { fromBaseUnits } from '../util/units.js';
import { fetchV1Activity } from './evm-blockscout.js';
import { getV1, lower, type V1Envelope } from './evm-common.js';
import type { ChainProvider, CollectOptions, FetchContext, ProviderActivity } from './types.js';

const BASE = 'https://api.etherscan.io/v2/api';

/**
 * Etherscan V2 multichain provider.
 *
 * Registered only when `ETHERSCAN_API_KEY` is set, and it outranks Blockscout when it is: one key
 * covers every EVM chain in the registry, pages further per request and rate limits far higher.
 */
export class EtherscanProvider implements ChainProvider {
  readonly name = 'etherscan';
  readonly namespace = 'evm' as const;
  readonly priority = 100;

  constructor(private readonly apiKey: string) {}

  static fromEnv(): EtherscanProvider | undefined {
    const key = process.env.ETHERSCAN_API_KEY?.trim();
    return key ? new EtherscanProvider(key) : undefined;
  }

  supports(chain: ChainDescriptor): boolean {
    return chain.namespace === 'evm' && chain.etherscanV2 === true && chain.evmChainId !== undefined;
  }

  async fetchActivity(ref: AddressRef, options: CollectOptions, ctx: FetchContext): Promise<ProviderActivity> {
    const chain = getChain(ref.chain);
    return fetchV1Activity(
      this.name,
      chain,
      BASE,
      { chainid: chain.evmChainId as number, apikey: this.apiKey },
      ref,
      options,
      ctx,
    );
  }

  async fetchFacts(ref: AddressRef, ctx: FetchContext): Promise<Partial<AccountFacts>> {
    const chain = getChain(ref.chain);
    const facts: Partial<AccountFacts> = {};
    const params = {
      chainid: chain.evmChainId as number,
      apikey: this.apiKey,
      module: 'account',
      action: 'balance',
      address: ref.address,
      tag: 'latest',
    };
    const balance = await cached(ctx.cache, `es:bal:${ref.key}`, ctx.cacheTtlSeconds, () =>
      getV1<V1Envelope>(this.name, chain.slug, BASE, params, ctx).catch(() => ({}) as V1Envelope),
    );
    if (typeof balance.result === 'string' && /^\d+$/.test(balance.result)) {
      facts.balance = fromBaseUnits(balance.result, chain.nativeDecimals);
    }

    const source = await cached(ctx.cache, `es:src:${ref.key}`, ctx.cacheTtlSeconds, () =>
      getV1<{ result?: { ContractName?: string; ABI?: string }[] }>(
        this.name,
        chain.slug,
        BASE,
        {
          chainid: chain.evmChainId as number,
          apikey: this.apiKey,
          module: 'contract',
          action: 'getsourcecode',
          address: ref.address,
        },
        ctx,
      ).catch(() => ({ result: [] })),
    );
    const entry = source.result?.[0];
    if (entry) {
      const isContract = Boolean(entry.ABI && entry.ABI !== 'Contract source code not verified')
        || Boolean(entry.ContractName);
      if (isContract) facts.isContract = true;
    }

    const creation = await cached(ctx.cache, `es:create:${ref.key}`, ctx.cacheTtlSeconds, () =>
      getV1<{ result?: { contractCreator?: string; txHash?: string }[] }>(
        this.name,
        chain.slug,
        BASE,
        {
          chainid: chain.evmChainId as number,
          apikey: this.apiKey,
          module: 'contract',
          action: 'getcontractcreation',
          contractaddresses: ref.address,
        },
        ctx,
      ).catch(() => ({ result: [] })),
    );
    const created = creation.result?.[0];
    if (created?.contractCreator) {
      facts.isContract = true;
      facts.creator = lower(created.contractCreator);
      if (created.txHash) facts.creationTx = created.txHash;
    }
    return facts;
  }
}
