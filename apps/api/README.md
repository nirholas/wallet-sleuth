# @wallet-sleuth/api

The Wallet Sleuth HTTP server. It exposes the analysis API, runs the job queue, and serves the built web
client from the same port.

```bash
npm run build --workspace @wallet-sleuth/core
npm run build --workspace @wallet-sleuth/api
node apps/api/dist/server.js
```

Listens on `PORT` (default 8787). Interactive API reference at `/docs/api`.

## Routes

| Route | Purpose |
| --- | --- |
| `POST /v1/analyze` | Start an analysis. Returns a job handle, or the report with `wait: true`. |
| `GET /v1/jobs/:id` | Job status |
| `GET /v1/jobs/:id/events` | Server-sent progress and the finished report |
| `GET /v1/jobs/:id/report` | The completed report |
| `GET /v1/jobs/:id/export` | `edges.csv`, `accounts.csv`, `graphml` or `json` |
| `DELETE /v1/jobs/:id` | Cancel |
| `POST /v1/parse` | Validate addresses without spending upstream requests |
| `GET /v1/chains`, `/v1/signals`, `/v1/version` | Capabilities |
| `GET /healthz`, `/readyz` | Liveness and readiness |

Full request and response shapes: [docs/api.md](../../docs/api.md).

## Why jobs rather than a synchronous call

An analysis reads live chain data and takes tens of seconds against keyless public endpoints, which
is longer than most proxies will hold a connection open. Callers submit a job, watch it over
server-sent events, and collect the report when it lands. `wait: true` is available for scripts that
would rather block.

Jobs live in memory in the process that ran them and are dropped after `SLEUTH_JOB_RETENTION_MS`
(one hour by default). Behind a load balancer, either pin sessions or use `wait: true`.

## Configuration

Every variable is optional; the server runs with an empty environment. The full table is in
[docs/self-hosting.md](../../docs/self-hosting.md). The ones that matter most:

- `SLEUTH_API_KEYS` turns on bearer authentication for `/v1`.
- `SLEUTH_RATE_LIMIT` and `SLEUTH_ANALYZE_RATE_LIMIT` bound general and analysis traffic.
- `REDIS_URL` shares the provider cache across instances.
- `ETHERSCAN_API_KEY` and `HELIUS_API_KEY` make collection much faster.
