<h1 align="center">Braid</h1>

<p align="center">
  <strong>Wallet linkage analysis for EVM and Solana.</strong><br>
  Paste public addresses. Find out whether they are connected, and see the transactions that prove it.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/signals.md">Signals</a> ·
  <a href="docs/scoring.md">Scoring</a> ·
  <a href="docs/api.md">API</a> ·
  <a href="docs/self-hosting.md">Self-hosting</a> ·
  <a href="docs/privacy-and-ethics.md">Ethics</a>
</p>

---

Braid answers one question: **do these wallet addresses belong together?**

Give it a list of public addresses on any mix of supported EVM chains and Solana. It reads their real
on-chain history, runs fourteen linkage signals over it, and returns a score for every pair together
with the exact transactions behind each score.

It is not an identity tool. Braid never tells you *who* owns an address, because public chain data
does not contain that. It tells you which addresses behave as though one operator is behind them, and
it shows its work so you can judge for yourself.

## Quick start

```bash
git clone https://github.com/braid-tools/braid.git
cd braid
npm install
npm run build
npm start
```

Open <http://localhost:8787>. No API key, no account, no configuration: Braid reads from keyless
public endpoints out of the box.

```bash
# command line
node apps/cli/dist/index.js analyze \
  0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B --chains ethereum -v

# HTTP
curl -s localhost:8787/v1/analyze -H 'content-type: application/json' -d '{
  "addresses": ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
                "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"],
  "wait": true
}' | jq '.edges[0] | {score, band, signals}'
```

```json
{
  "score": 94,
  "band": "confirmed",
  "signals": ["solana-fee-payer", "direct-transfer"]
}
```

## What makes a link

Braid runs fourteen signals across five categories. Weights are deliberately unequal: reading an
ownership record off chain state is a different kind of claim from noticing two wallets are awake at
the same time of day.

| Category | Signals | What they read |
| --- | --- | --- |
| **Control** | on-chain token account ownership, shared transaction signer, contract deployment, gas sponsorship | State and signatures. The only category that can prove a link on its own. |
| **Funding** | first funder is the peer, shared first funder, shared funder, batch funding | Where an address got its money, especially its first money. |
| **Flow** | direct transfers, shared payout target, cross-chain stablecoin handoff | Value moving between the addresses or into the same place. |
| **Coactivity** | counterparty set overlap | The company an address keeps, once the places everybody visits are removed. |
| **Behavioral** | activity-hour profile, asset mix | Habits. Corroboration only, never sufficient alone. |

Full descriptions, including how each one can be wrong, are in [docs/signals.md](docs/signals.md).

## What makes it trustworthy

**Every claim is checkable.** Each piece of evidence carries the amounts, the timings and the
explorer links. You never have to take a score on faith.

**It refuses to guess.** The first-funding signals are the strongest ordinary evidence Braid has, and
they are withheld entirely unless the sample provably reaches the account's first transaction. On a
truncated history the earliest transfer visible is an artefact of the budget, not an opening balance.

**Hubs are removed before they become evidence.** Two addresses both using Uniswap is not a link.
Braid drops labelled services, contracts and high-degree counterparties, then resolves what remains:
a shared counterparty that forwards into an exchange is a per-customer deposit address, and that
*is* a link. The report lists everything it discounted and why.

**It tells you what it could not do.** Truncated history, expired budgets, rate limited providers,
endpoints that disagreed about how much history exists, input addresses that are known services:
all of it lands in the report's caveats rather than being quietly absorbed into a number.

**Scores do not stack naively.** Repeats of one signal decay, independent signals combine with a
noisy-OR, and no amount of weak evidence ever reaches certainty. See [docs/scoring.md](docs/scoring.md).

## Keyless by default, fast when configured

Braid ships reading from public Blockscout instances and public Solana RPC endpoints, because a tool
that needs three API keys before it can answer a question does not get used. Those endpoints throttle,
so Braid paces itself per host with an adaptive backoff, learns undeclared batch limits from the
errors that announce them, treats rate limits hidden inside HTTP 200 responses as throttling, and
cross-checks any short history page against every other configured endpoint before believing it.

Set `ETHERSCAN_API_KEY` and `HELIUS_API_KEY` and the same analysis runs roughly an order of magnitude
faster. Nothing else changes. See [docs/providers.md](docs/providers.md).

## Chains

Ethereum, Base, Arbitrum, OP Mainnet, Polygon, Gnosis, Scroll, ZKsync Era, Celo, Unichain, BNB Smart
Chain, Avalanche, Linea, Blast, and Solana. A bare EVM address is looked up on every selected EVM
chain, because one key controls the same address on all of them.

## Repository layout

| Path | What it is |
| --- | --- |
| [`packages/core`](packages/core) | The engine: providers, signals, scoring, clustering, exports |
| [`apps/api`](apps/api) | Fastify HTTP API, job queue, OpenAPI, and the host for the web client |
| [`apps/web`](apps/web) | React client: address input, live progress, graph, evidence |
| [`apps/cli`](apps/cli) | `braid` command line interface |
| [`docs`](docs) | The documentation, rendered as-is by the website |
| [`scripts`](scripts) | Maintenance scripts, including the signal doc generator |

## Development

```bash
npm install
npm run dev          # API on :8787 and the web client on :5173
npm test             # unit and API tests, no network
npm run test:live    # integration tests against the real public endpoints
npm run typecheck
npm run lint
npm run docs:signals # regenerate docs/signals.md from the signal registry
```

`docs/signals.md` is generated from the descriptions attached to each signal in
`packages/core/src/signals`, so the documentation and the behaviour are edited in the same place and
cannot drift.

## A word about what this is for

Chain analysis holds exchanges accountable, traces stolen funds, and catches sybil attacks. It is
also used to stalk and to dox. The technology does not distinguish between those uses; the people
building and running it have to. Braid reads public data only, stores nothing, identifies nobody, and
shows its evidence so a claim can be checked rather than trusted. Please read
[docs/privacy-and-ethics.md](docs/privacy-and-ethics.md) before you deploy it.

## License

MIT. See [LICENSE](LICENSE).
