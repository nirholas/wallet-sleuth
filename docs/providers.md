# Data providers

Braid reads live chain data. It has no database of its own and no cached view of the world beyond a
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
failure attached; Braid never substitutes invented data for a failed lookup.

## Making it faster

**`ETHERSCAN_API_KEY`** is the single highest impact setting. One Etherscan V2 key covers every EVM
chain in the registry, pages further per request, and raises the rate limit by an order of magnitude.
A free key is enough.

**`HELIUS_API_KEY`** or **`SOLANA_RPC_URLS`** does the same for Solana. Set `SOLANA_RPC_URLS` to a
comma separated list, highest priority first; the public defaults are appended as a fallback.

**`REDIS_URL`** shares the provider cache between instances, so a fleet behind a load balancer pays
for each upstream read once. Transactions are cached for a week because a confirmed transaction never
changes; everything else uses `BRAID_CACHE_TTL_SECONDS` (default 900).

## How Braid behaves against public endpoints

Public endpoints rate limit, and they do it in ways that are easy to mishandle. Braid handles four
specific behaviours, all of which were observed against the default endpoints:

**Rate limiting by HTTP 429.** Every outbound request passes through a per-host queue with a
concurrency cap and a minimum gap between requests. The gap is adaptive: it starts optimistic, a 429
widens it sharply, and sustained success narrows it back. Nobody's limits are hardcoded.

**Rate limiting inside a 200 response.** One of the default Solana endpoints answers a batch request
with HTTP 200 and a body full of per-item rate limit errors. Braid treats those as throttling, which
demotes the endpoint in its health ranking, rather than as missing data.

**Undeclared batch limits.** Another endpoint accepts at most one `getTransaction` per batch and says
so in an HTTP 400. Braid reads the limit out of the error and adapts to it permanently, then works at
that size.

**Silently truncated history.** The two default Solana endpoints do not serve the same depth of
history: one returns six signatures for an account where the other returns a hundred, with no error.
This is the dangerous one, because believing the short answer makes an account look nearly inactive
and turns whatever transfer happened to be visible into a false "first funding". So any signature
page shorter than requested is cross-checked against every other configured endpoint, the fullest
answer wins, and a disagreement is written into the report.

Endpoints are ranked by a decaying success rate, so work flows to whichever one is actually serving
it. `GET /readyz` exposes the live pacing and health per host.

## Labels

Braid ships a curated list of service addresses: exchange hot wallets, bridges, routers, mixers,
staking contracts, well known tokens and Solana programs. Their role is to mark counterparties whose
co-occurrence proves nothing, so that "both addresses used Uniswap" never becomes evidence.

Labels are not the only defence. Braid also treats a counterparty as a hub when it is a contract, or
when it is touched by a large share of the analysed addresses. Unlabelled services are therefore
discounted automatically, just less confidently.

To add your own attribution, point `BRAID_LABELS_FILE` at a JSON file shaped like the built-in one:

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
