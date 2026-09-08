# Changelog

All notable changes to Braid are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-09-08

First release.

### Added

- **Linkage engine** (`@braid/core`) with fourteen signals across control, funding, flow, coactivity
  and behavioral categories, evidence-based scoring with noisy-OR combination, and union-find
  clustering with weakest-link reporting.
- **EVM support** for Ethereum, Base, Arbitrum, OP Mainnet, Polygon, Gnosis, Scroll, ZKsync Era,
  Celo, Unichain, BNB Smart Chain, Avalanche, Linea and Blast, through keyless Blockscout instances
  or the Etherscan V2 multichain API when a key is configured.
- **Solana support** over plain JSON-RPC, resolving SPL token accounts to their owning wallets, with
  fee-payer and account-ownership signals that read control directly from chain state.
- **Cross-chain correlation** by matching stablecoin amounts across chains inside a tight window.
- **HTTP API** with a job queue, server-sent progress events, OpenAPI documentation at `/docs/api`,
  optional bearer authentication, per-route rate limiting, and CSV, GraphML and JSON exports.
- **Web client** with live progress, an interactive linkage graph, per-signal evidence with explorer
  links, and the full documentation set rendered from the repository's markdown.
- **CLI** (`braid analyze`, `braid signals`, `braid chains`) with human, JSON, CSV and GraphML output.
- **Adaptive provider transport**: per-host request pacing that widens on rate limits and narrows on
  success, endpoint health ranking, batch limits learned from the errors that declare them, per-item
  rate limits detected inside HTTP 200 responses, and cross-endpoint verification of any Solana
  signature page that comes back shorter than requested.
- **Honest reporting**: first-funding signals are withheld unless the sample provably reaches an
  account's first transaction, and every coverage gap, truncation, provider failure and hub exclusion
  is written into the report.
