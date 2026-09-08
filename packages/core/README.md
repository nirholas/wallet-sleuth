# @braid/core

The Braid linkage engine: providers, signals, scoring and clustering. Everything the HTTP API, the
CLI and the web client sit on top of.

```bash
npm install @braid/core
```

## Usage

```ts
import { analyze } from '@braid/core';

const report = await analyze(
  {
    addresses: [
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
    ],
    chains: ['ethereum'],
    options: { maxTransfersPerAddress: 400, minScore: 15 },
  },
  { onProgress: (event) => console.log(event.phase, event.message) },
);

for (const edge of report.edges) {
  console.log(edge.score, edge.band, edge.a, edge.b);
  for (const evidence of edge.evidence) {
    console.log('  ', evidence.title, evidence.detail);
  }
}
```

`analyze` reads live chain data. It needs no configuration: EVM chains are read through public
Blockscout instances and Solana through public RPC endpoints. `ETHERSCAN_API_KEY` and
`HELIUS_API_KEY` make it substantially faster.

## Exports

**Analysis.** `analyze`, `resolveOptions`, `DEFAULT_OPTIONS`, `MAX_ADDRESSES`, `VERSION`.

**Addresses.** `parseAddressList`, `makeRef`, `toChecksumAddress`, `isEvmAddress`, `isSolanaAddress`,
`detectNamespace`, `addressKey`, `parseKey`, `shortAddress`.

**Chains.** `listChains`, `defaultChains`, `resolveChain`, `getChain`, `chainByEvmId`, `addressUrl`,
`txUrl`.

**Signals.** `ALL_SIGNALS`, `SIGNALS_BY_ID`, `runSignals`, `buildContext`, `buildIndex`, and every
signal individually. Each carries `id`, `category`, `weight` and a `description` that documents what
it proves and how it can be wrong.

**Scoring.** `scoreEdges`, `combineWithinSignal`, `bandFor`, `BANDS`, `buildClusters`, `UnionFind`.

**Providers.** `buildProviders`, `providersFor`, `BlockscoutProvider`, `EtherscanProvider`,
`SolanaRpcProvider`, plus the `ChainProvider` interface for adding your own.

**Labels.** `labels`, `LabelRegistry`, `resetLabels`. Extend with `BRAID_LABELS_FILE`.

**Exports.** `edgesToCsv`, `accountsToCsv`, `toGraphml`.

**Caching.** `MemoryCache`, `NullCache`, `cached`, and the `CacheStore` interface. Pass your own
through `analyze`'s deps to share a cache across processes.

## Extending it

To add a data source, implement `ChainProvider` and pass it in `deps.providers`. To add a signal,
implement the `Signal` interface and register it. Both are covered in
[CONTRIBUTING.md](../../CONTRIBUTING.md).

## Design notes

- Every stage degrades rather than fails. A provider outage costs coverage and is recorded in the
  report; it never produces substituted data.
- The first-funding signals are gated on `reachedGenesis`, which is only true when the sample provably
  reaches an account's first transaction.
- Scores combine with a noisy-OR across signals and a decaying combination within a signal, so no
  amount of repetition reaches certainty. See [docs/scoring.md](../../docs/scoring.md).
