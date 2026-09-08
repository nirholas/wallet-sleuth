# HTTP API

Base URL is wherever you run the server; the examples use `http://localhost:8787`. An interactive
OpenAPI reference is served at `/docs/api`, and the raw document at `/docs/api/json`.

## Authentication

None by default. Set `SLEUTH_API_KEYS` to a comma separated list to require
`Authorization: Bearer <key>` on every `/v1` route. Rate limiting is per API key when keys are in
use, per IP otherwise. `SLEUTH_RATE_LIMIT` (default 60/minute) covers general traffic and `0` disables
it; `SLEUTH_ANALYZE_RATE_LIMIT` (default 10/minute) applies on top of it to `POST /v1/analyze`, the
only route that spends upstream requests. `/healthz`, `/readyz`, `/v1/chains`, `/v1/signals` and
`/v1/version` are exempt, because counting page loads against the budget locks people out of the
tool itself.

## Lifecycle

An analysis reads live chain data and takes tens of seconds, which is too long to hold an HTTP
request open through most proxies. The normal flow is:

1. `POST /v1/analyze` returns `202` with a job handle.
2. Stream `GET /v1/jobs/{id}/events` for progress, or poll `GET /v1/jobs/{id}`.
3. Fetch `GET /v1/jobs/{id}/report` when the status is `done`.

Scripts that would rather block can pass `"wait": true` and get the finished report back from the
same call.

## POST /v1/analyze

```json
{
  "addresses": ["0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"],
  "chains": ["ethereum", "base", "solana"],
  "wait": false,
  "options": {
    "maxTransfersPerAddress": 400,
    "lookbackDays": 0,
    "minScore": 15,
    "clusterThreshold": 55,
    "hubShareThreshold": 8,
    "enrichCounterparties": true,
    "budgetMs": 120000,
    "signals": []
  }
}
```

`addresses` accepts an array or a single string containing whitespace, comma or semicolon separated
addresses. `chains` is optional; omitted, bare EVM addresses fan out across the default EVM chains.
An empty `signals` array means every signal.

Response, `202`:

```json
{
  "id": "0f0f2e0c-...",
  "status": "queued",
  "createdAt": "2026-09-08T12:00:00.000Z",
  "progress": { "phase": "parse", "progress": 0, "message": "queued" },
  "addresses": 2,
  "links": {
    "self": "/v1/jobs/0f0f2e0c-.../",
    "events": "/v1/jobs/0f0f2e0c-.../events",
    "report": "/v1/jobs/0f0f2e0c-.../report"
  }
}
```

Errors: `400` for unusable input (with the per-address reasons in `details`), `401` when a key is
required, `429` when rate limited.

## GET /v1/jobs/{id}

The same job view. `status` is one of `queued`, `running`, `done`, `failed`, `cancelled`.

## GET /v1/jobs/{id}/events

Server-sent events. Two event types:

- `status`: a job view, on every progress update.
- `report`: the finished report, once.

The stream sends a comment heartbeat every 15 seconds and closes itself when the job reaches a
terminal state. Clients should also be able to fall back to polling: the bundled web client does,
because some proxies buffer `text/event-stream` into uselessness.

```bash
curl -N http://localhost:8787/v1/jobs/$ID/events
```

## GET /v1/jobs/{id}/report

The full report. `409` if the job is not finished, with the current status and progress in the body.
The report shape is documented in [interpreting results](./interpreting-results.md) and typed in
`@wallet-sleuth/core`'s `AnalysisReport`.

## GET /v1/jobs/{id}/export?format=

`edges.csv` (default), `accounts.csv`, `graphml`, or `json`. GraphML opens directly in Gephi, yEd and
Cytoscape Desktop.

## DELETE /v1/jobs/{id}

Cancels a queued or running job.

## POST /v1/parse

Validates an address list without spending any upstream requests. Returns the accepted references,
the rejected input with reasons, and the count of distinct addresses. The web client calls this as
you type.

## GET /v1/chains

Every chain Wallet Sleuth can read, with its namespace, EIP-155 id where applicable, native symbol and
explorer URLs.

## GET /v1/signals

The live signal catalogue: id, title, category, weight, applicable namespaces and the full
description. This is the same text that generates [the signals page](./signals.md), read from the
running engine.

## GET /v1/version

Engine version, the maximum addresses per analysis, the default options and the band definitions.

## GET /healthz and /readyz

`/healthz` is a liveness check. `/readyz` reports the configured providers, whether the cache backend
is reachable, current job queue depth and the live per-host request pacing, and returns `503` when
the service is degraded. Both are exempt from rate limiting.
