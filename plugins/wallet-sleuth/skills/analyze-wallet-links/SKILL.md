---
name: analyze-wallet-links
description: Run Wallet Sleuth from a clone to find out whether public EVM or Solana addresses are linked, using the sleuth CLI or its local HTTP API. Use when asked how wallets are connected, to cluster addresses, or to gather on-chain evidence for a linkage claim.
---

# Analyze wallet links with Wallet Sleuth

Wallet Sleuth reads public on-chain history for a set of addresses, runs fourteen linkage signals,
and returns a score per address pair with the transactions behind it. It never identifies who owns an
address. Report scores and evidence, and state caveats the report lists.

The package is private and not on npm, so it runs from a clone. Node 20.11 or newer is required.

## Setup

```bash
git clone https://github.com/nirholas/wallet-sleuth.git
cd wallet-sleuth
npm install
npm run build
```

No API key is needed. Optional env vars make it much faster: `ETHERSCAN_API_KEY` (one V2 key covers
every EVM chain), `HELIUS_API_KEY` or `SOLANA_RPC_URLS` (Solana).

## CLI

The binary is `sleuth` (`node apps/cli/dist/index.js`, also `npm run sleuth --`).

```bash
node apps/cli/dist/index.js analyze <address...> [options]
node apps/cli/dist/index.js signals     # list the signal ids
node apps/cli/dist/index.js chains      # list supported chain ids
```

Options: `--chains <list>`, `--depth <n>` (transfers per address, default 400), `--lookback <days>`,
`--min-score <n>` (default 15), `--cluster-at <n>` (default 55), `--signals <list>`,
`--budget <seconds>` (default 120), `--no-enrich`, `--json`, `--csv <edges|accounts>`, `--graphml`,
`--out <file>`, `-q`, `-v` (show every piece of evidence). Addresses can also be piped on stdin.

Example:

```bash
node apps/cli/dist/index.js analyze \
  0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B --chains ethereum -v
```

Use `--json --out report.json` when you need to post-process the report.

## HTTP API

`npm start` serves on `http://localhost:8787` (the web client is at `/`, OpenAPI at `/docs/api`).

```bash
curl -s localhost:8787/v1/analyze -H 'content-type: application/json' -d '{
  "addresses": ["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
                "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"],
  "wait": true
}' | jq '.edges[0] | {score, band, signals}'
```

Without `"wait": true`, `POST /v1/analyze` returns 202 with a job: poll `GET /v1/jobs/{id}`, stream
`GET /v1/jobs/{id}/events`, then read `GET /v1/jobs/{id}/report`. Exports are at
`GET /v1/jobs/{id}/export?format=` (`edges.csv`, `accounts.csv`, `graphml`, `json`).
`DELETE /v1/jobs/{id}` cancels. Set `SLEUTH_API_KEYS` to require `Authorization: Bearer <key>`.

## Reading the result

Each edge has a `score` (0 to 100), a `band` (confirmed 85+, strong 65 to 84, moderate 40 to 64, weak 20 to 39), and the `signals` that fired. Control
signals (token account ownership, shared signer, deployment, gas sponsorship) can prove a link alone.
Behavioral signals (activity hours, asset mix) are corroboration only. Always surface the report's
caveats: truncated history, expired budget, rate-limited providers. Never claim identity.
