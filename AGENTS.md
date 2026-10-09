# AGENTS.md

Operating notes for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository. Everything here is derived from the files actually in the tree, so trust it over guesses, and update it when the facts change.

## What this repository is

Wallet linkage analysis for EVM and Solana. Paste public addresses, get the on-chain evidence that ties them together.

- Source: https://github.com/nirholas/wallet-sleuth
- Primary language: TypeScript
- License: Other (see the LICENSE file)

## Repository layout

- `apps/`
- `docs/`
- `packages/`
- `scripts/`
- `test/`
- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CHANGELOG.md`
- `package.json`
- `Dockerfile`

Tests live in `test/`. Add or update a test next to the code you change.

## Setup

```bash
npm install
```

## Commands

| Task | Command |
|---|---|
| dev | `npm run dev` |
| start | `npm start` |
| build | `npm run build` |
| test | `npm test` |
| lint | `npm run lint` |
| typecheck | `npm run typecheck` |
| format | `npm run format` |
| check | `npm run check` |
| build image | `docker build .` |

Run the test and lint commands above before you consider a change finished. If a command fails on code you did not touch, say so in your report instead of silently skipping it.

## Conventions

- This is a monorepo (`workspaces` in `package.json`); run scripts from the root unless a package README says otherwise.
- `.env` files are gitignored; never commit credentials, and read configuration from environment variables.
- Commit messages follow Conventional Commits (`type(scope): summary`), matching the existing history.
- Read `CONTRIBUTING.md` before opening a pull request.
- User-visible changes get an entry in `CHANGELOG.md`.
- Read the surrounding code before adding to it, and match its naming, file organisation and error-handling style.
- Keep `README.md` accurate: if a change alters behaviour, commands or configuration, update the docs in the same commit.
- Do not leave TODO comments, stub functions, placeholder data or commented-out code behind. Finish what you start or leave it out.
- Small, focused commits with a subject line that describes the change, not the act of committing.

## Where to raise things

- Bugs and feature requests: https://github.com/nirholas/wallet-sleuth/issues
- Questions and ideas: https://github.com/nirholas/wallet-sleuth/discussions
- Security issues: follow `SECURITY.md`, never a public issue.
