# Self-hosting

Wallet Sleuth is one Node process. It serves the API and the built web client from the same port.

## Requirements

Node 20.11 or newer. Nothing else: no database, no queue, no object storage.

## Run it

```bash
git clone https://github.com/nirholas/wallet-sleuth.git
cd sleuth
npm install
npm run build
npm start
```

`npm start` serves on `PORT` (default 8787). The web client is served at `/`, the API under `/v1`,
and the OpenAPI reference at `/docs/api`.

## Docker

The repository ships a [Dockerfile](../Dockerfile): a two stage build that installs, builds every
workspace, prunes the dev dependencies and runs as the unprivileged `node` user.

```bash
docker build -t sleuth .
docker run -p 8787:8787 -e ETHERSCAN_API_KEY=... sleuth
```

The image contains the API, the built web client, the OpenAPI reference and the documentation, and
listens on one port. It has no volumes and no state: restart it and the analyses are gone.

## Configuration

Everything is optional. Wallet Sleuth runs with an empty environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Listen port |
| `HOST` | `0.0.0.0` | Listen address |
| `LOG_LEVEL` | `info` | Pino log level |
| `SLEUTH_CORS_ORIGINS` | none | Comma separated origins allowed to call the API from a browser. Empty means same-origin only. |
| `SLEUTH_API_KEYS` | none | Comma separated bearer keys. When set, `/v1` requires one. |
| `SLEUTH_RATE_LIMIT` | `60` | Requests per minute per key or IP. `0` disables. Health checks and the read-only metadata routes are exempt. |
| `SLEUTH_ANALYZE_RATE_LIMIT` | `10` | Analyses started per minute. The only route that spends upstream requests. |
| `SLEUTH_MAX_CONCURRENT_JOBS` | `4` | Analyses running at once. Excess submissions queue. |
| `SLEUTH_JOB_RETENTION_MS` | `3600000` | How long a finished report stays retrievable. |
| `REDIS_URL` | none | Shared provider cache |
| `SLEUTH_CACHE_TTL_SECONDS` | `900` | Cache lifetime for mutable reads |
| `ETHERSCAN_API_KEY` | none | Faster, deeper EVM collection |
| `HELIUS_API_KEY` | none | Faster Solana collection |
| `SOLANA_RPC_URLS` | public endpoints | Comma separated RPC URLs, highest priority first |
| `SLEUTH_LABELS_FILE` | none | Extra service labels, layered on the built-in set |
| `SLEUTH_HOST_CONCURRENCY` | `6` | In-flight requests per upstream host |
| `SLEUTH_HOST_MIN_INTERVAL_MS` | `60` | Starting gap between requests to one host |
| `SLEUTH_HOST_MAX_INTERVAL_MS` | `2000` | Ceiling the adaptive backoff will widen to |
| `SLEUTH_WEB_ROOT` | auto | Override where the built web client is served from |

## Operating it

**Health.** `/healthz` for liveness, `/readyz` for readiness. `/readyz` returns `503` when the cache
backend is unreachable or no provider is available, and its body carries queue depth and live
per-host pacing, which is the first place to look when analyses get slow.

**Scaling.** Analyses are CPU-cheap and network-bound; the limit is upstream rate limits, not your
hardware. Run several instances behind a load balancer with a shared `REDIS_URL` so they do not each
pay for the same reads. Raising `SLEUTH_MAX_CONCURRENT_JOBS` past a handful will usually make
everything slower, not faster, because the upstream endpoints are the bottleneck.

**Job storage is in memory.** Reports are held for `SLEUTH_JOB_RETENTION_MS` in the process that ran
them. Behind a load balancer, either pin sessions or have clients pass `wait: true`. Nothing is
persisted to disk, which is also the privacy story: restart the process and the analyses are gone.

**Security.** Set `SLEUTH_API_KEYS` on anything public, keep `SLEUTH_CORS_ORIGINS` empty unless a
browser on another origin genuinely needs access, and put it behind TLS. Wallet Sleuth sets a strict
Content-Security-Policy when it is serving the web client. It makes outbound requests only to the
configured providers.
