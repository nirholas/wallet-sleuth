# Data providers

Wallet Sleuth reads live chain data. It has no database of its own and no cached view of the world beyond a
short lived request cache.

## Keyless by default

Out of the box, with no configuration:

- **EVM chains** are read through public [Blockscout](https://www.blockscout.com/) instances.
- **Solana** is read through public JSON-RPC endpoints.

That is a deliberate design constraint: a tool that needs three API keys before it can answer a
question does not get used. The cost is speed, and the honest ceiling of the free endpoints.

## Provider chain

| Provider | Chains | Requires | Priority |
| --- | --- | --- | --- |
| `etherscan` | Every EVM chain in the registry | `ETHERSCAN_API_KEY` | 100 |
| `solana-rpc` | Solana | nothing (public endpoints) | 50 |
| `blockscout` | EVM chains with a public instance | nothing | 10 |

Providers are tried highest priority first, and a failure falls through to the next one that supports
the chain. When every provider for an address fails, the address still appears in the report with the
failure attached; Wallet Sleuth never substitutes invented data for a failed lookup.

## Making it faster

**`ETHERSCAN_API_KEY`** is the single highest impact setting. One Etherscan V2 key covers every EVM
chain in the registry, pages further per request, and raises the rate limit by an order of magnitude.
A free key is enough.

**`HELIUS_API_KEY`** or **`SOLANA_RPC_URLS`** does the same for Solana. Set `SOLANA_RPC_URLS` to a
comma separated list, highest priority first; the public defaults are appended as a fallback.

**`REDIS_URL`** shares the provider cache between instances, so a fleet behind a load balancer pays
for each upstream read once. Transactions are cached for a week because a confirmed transaction never
changes; everything else uses `SLEUTH_CACHE_TTL_SECONDS` (default 900).

## How Wallet Sleuth behaves against public endpoints

Public endpoints rate limit, and they do it in ways that are easy to mishandle. Wallet Sleuth handles four
specific behaviours, all of which were observed against the default endpoints:

**Rate limiting by HTTP 429.** Every outbound request passes through a per-host queue with a
concurrency cap and a minimum gap between requests. The gap is adaptive: it starts optimistic, a 429
widens it sharply, and sustained success narrows it back. Nobody's limits are hardcoded.

**Rate limiting inside a 200 response.** One of the default Solana endpoints answers a batch request
with HTTP 200 and a body full of per-item rate limit errors. Wallet Sleuth treats those as throttling, which
demotes the endpoint in its health ranking, rather than as missing data.

**Undeclared batch limits.** Another endpoint accepts at most one `getTransaction` per batch and says
so in an HTTP 400. Wallet Sleuth reads the limit out of the error and adapts to it permanently, then works at
that size.

**Silently truncated history.** The two default Solana endpoints do not serve the same depth of
history: one returns six signatures for an account where the other returns a hundred, with no error.
This is the dangerous one, because believing the short answer makes an account look nearly inactive
and turns whatever transfer happened to be visible into a false "first funding". So any signature
page shorter than requested is cross-checked against every other configured endpoint, the fullest
answer wins, and a disagreement is written into the report.

Endpoints are ranked by a decaying success rate, so work flows to whichever one is actually serving
it. `GET /readyz` exposes the live pacing and health per host.

## Enrichment lanes, also keyless

History alone produces a graph of base58 strings moving unnamed tokens, which is technically correct
and useless to read. Three more public endpoints turn that into something an investigator can reason
about. All three are keyless, all three are best effort, and none of them can fail an analysis: a
lane that is down costs a label or a dollar sign, never a result.

| Lane | Source | What it adds |
| --- | --- | --- |
| Valuation | [DefiLlama coins](https://defillama.com/docs/api) | USD value per transfer, for both namespaces from one request shape (`solana:<mint>`, `ethereum:<contract>`, `coingecko:<id>` for natives) |
| Solana token names | [Jupiter token search](https://station.jup.ag/) | Symbols for mints the RPC returns unnamed |
| Solana domains | [Bonfida SNS](https://sns.guide/) | `.sol` reverse records, the counterpart to ENS on the EVM side |
| Sanctions | [OFAC SDN mirror](https://github.com/0xB10C/ofac-sanctioned-digital-currency-addresses) | Whether an address appears on the US Treasury sanctions list for its chain |

ENS names need no lane of their own: Blockscout already returns `ens_domain_name` with account facts.

Sanctions screening is the exception to "best effort". A false negative there matters more than
latency, so the lists are cached for hours rather than days, and a list that fails to load is stated
in the report: **"not screened" and "screened clean" are very different claims and must never look
alike.** The source is a parsed mirror of the published SDN list, not the register itself, so a hit
is a strong signal to verify against Treasury directly and never a legal conclusion on its own.

Valuation quotes carry a confidence score and anything below 0.7 is discarded rather than shown,
because a thin-liquidity quote on an obscure token is worse than no number at all. Assets that cannot
be priced are listed in the report as `unpricedAssets` and their flows are sized by transfer count
instead of dollars, so an unpriced token is never quietly dropped from the picture.

## Labels

Wallet Sleuth ships a curated list of service addresses: exchange hot wallets, bridges, routers, mixers,
staking contracts, well known tokens and Solana programs. Their role is to mark counterparties whose
co-occurrence proves nothing, so that "both addresses used Uniswap" never becomes evidence.

Labels are not the only defence. Wallet Sleuth also treats a counterparty as a hub when it is a contract, or
when it is touched by a large share of the analysed addresses. Unlabelled services are therefore
discounted automatically, just less confidently.

To add your own attribution, point `SLEUTH_LABELS_FILE` at a JSON file shaped like the built-in one:

```json
{
  "entries": [
    { "chain": "ethereum", "address": "0x...", "name": "Acme Exchange hot wallet", "kind": "exchange", "hub": true },
    { "chain": "*", "address": "0x...", "name": "Acme Router", "kind": "router", "hub": true }
  ]
}
```

`chain` may be a slug or `*` for every chain. `kind` is one of `exchange`, `bridge`, `router`,
`mixer`, `staking`, `infrastructure`, `token`, `burn`, `program`. `hub: true` means co-occurrence
carries no ownership information. Your entries layer on top of the built-in set.

## Adding a chain

Add a descriptor to `packages/core/src/chains.ts`. An EVM chain with a public Blockscout instance
needs nothing else; set `blockscout` to the instance URL and `etherscanV2: true` if Etherscan V2
covers it. A chain in a new namespace needs a provider implementing `ChainProvider`.
