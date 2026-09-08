# @wallet-sleuth/web

The Wallet Sleuth web client: address input with live validation, streaming progress, an interactive linkage
graph, and per-signal evidence with explorer links.

```bash
npm run dev --workspace @wallet-sleuth/web     # :5173, proxying the API on :8787
npm run build --workspace @wallet-sleuth/web   # emits dist/, served by @wallet-sleuth/api
```

Set `SLEUTH_API` to point the dev proxy somewhere other than `http://localhost:8787`.

## Structure

| Path | What it holds |
| --- | --- |
| `src/pages/Analyze.tsx` | The main flow: submit, follow, render |
| `src/pages/Signals.tsx` | The signal catalogue, read live from `/v1/signals` |
| `src/pages/Docs.tsx` | Renders the repository's `/docs` markdown, compiled in at build time |
| `src/components/AddressInput.tsx` | Input, chain selection, advanced options, live parse preview |
| `src/components/Graph.tsx` | Cytoscape force layout, coloured by cluster and confidence band |
| `src/components/Report.tsx` | Summary, links, evidence, clusters, coverage and provider tables |
| `src/lib/api.ts` | Typed API client, plus the SSE follower with its polling fallback |
| `src/styles/global.css` | Design tokens and every component style |

## Notes

**The documentation is not duplicated.** `src/lib/docs.ts` compiles `/docs/*.md` into the bundle, so
the site and the repository always show the same text.

**Progress falls back to polling.** Some proxies buffer `text/event-stream` into uselessness. If the
stream has not spoken within six seconds, the client switches to polling `/v1/jobs/:id`.

**The signal catalogue is read from the server**, not transcribed into the page, so it always
describes the engine actually running.
