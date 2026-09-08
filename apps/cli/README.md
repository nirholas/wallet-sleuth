# @wallet-sleuth/cli

The `sleuth` command line interface. Runs the engine in process; no server required.

```bash
npm run build --workspace @wallet-sleuth/core
npm run build --workspace @wallet-sleuth/cli
node apps/cli/dist/index.js analyze <address...> [options]
```

```bash
sleuth analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B \
  --chains ethereum --verbose

cat wallets.txt | sleuth analyze --json --out report.json
sleuth signals
sleuth chains
```

Progress goes to stderr and output to stdout, so redirecting never mixes the two. Output formats:
human (default), `--json`, `--csv edges|accounts`, `--graphml`.

Exit codes: `0` analysis completed (links may or may not have been found), `1` unusable input or a
failed analysis, `2` bad usage. Finding no link is a successful analysis, so it exits `0`.

Full flag reference: [docs/cli.md](../../docs/cli.md).
