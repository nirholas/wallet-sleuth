# Contributing

## Getting set up

```bash
npm install
npm run dev     # API on :8787, web client on :5173 with a proxy to it
npm test
```

No API keys are needed. `ETHERSCAN_API_KEY` and `HELIUS_API_KEY` make development noticeably faster
if you have them.

## Before you open a pull request

```bash
npm run check   # lint, typecheck, tests
```

`npm run test:live` runs the integration tests against the real public endpoints. They are slow and
depend on third parties, so they are not part of `npm run check`, but please run them when you touch
a provider.

## Adding a signal

A signal lives in `packages/core/src/signals` and is a pure function over collected activity. It must:

1. Declare an honest **weight**. Ask what the signal proves when it fires perfectly, and weight it
   against the existing set: on-chain ownership is 1.00, an hour-of-day profile is 0.15. A signal that
   is easy to produce by accident, or cheap for an adversary to fabricate, belongs near the bottom.
2. Compute a **strength** that reflects how well this instance fired, not just that it fired.
3. Write **evidence a human can check**: a title, a plain-language explanation that names the innocent
   interpretation where one exists, the observations behind it, and explorer links.
4. Exclude **hubs**. If the signal can fire on a shared exchange, router, bridge or contract, it will,
   and the result will be noise. Use `ctx.hubs` and `ctx.labels`.
5. Come with **tests**, including at least one case where the signal must stay silent.

Then register it in `packages/core/src/signals/index.ts` and run `npm run docs:signals`.
`docs/signals.md` is generated from the description on the signal object, so the prose and the code
are edited together and cannot drift.

## Adding a chain

Add a descriptor to `packages/core/src/chains.ts`. An EVM chain with a public Blockscout instance
needs nothing more. A chain in a new namespace needs a provider implementing `ChainProvider`, and its
own control signals to be worth much.

## Adding labels

Service addresses live in `packages/core/src/labels/known-entities.json`. Include a source you can
point at, and prefer being conservative: a wrong label silently suppresses real evidence.

## House rules

- **No mock data in shipped code.** Test fixtures are fine and are clearly marked as such; a fallback
  array of sample results in a code path a user can reach is not.
- **Degrade, do not fabricate.** When a provider fails, record it in the report. Never fill the gap.
- **Say what you could not do.** Anything that limits a result belongs in the report's caveats.
- **Explain the failure mode.** Every signal description names how the signal can be wrong. Keep that
  property; it is the difference between a tool people can use responsibly and one they cannot.
- Write comments that explain *why*, not *what*.

## Commit messages

`type(scope): what changed and why a reader would care.` Present tense, specific to the change.

## Contributions and licensing

Wallet Sleuth is proprietary; see [LICENSE](LICENSE). The repository is public so the behaviour can
be inspected, not to invite general contribution.

**Bug reports are genuinely welcome**, especially about correctness: a signal that can be cheaply
spoofed, a provider quirk that makes results wrong, a false positive with a mundane explanation. Open
an issue. Reports of that kind are the reason the source is readable at all.

**Pull requests are accepted only by prior arrangement.** Because the project is not open source,
merging outside code needs an explicit assignment of rights in the contribution to the copyright
holder. Ask in an issue before writing anything substantial, so nobody spends an evening on work that
cannot be taken.

If you want to use, deploy, or build on this, that is a licensing conversation rather than a pull
request. Open an issue.
