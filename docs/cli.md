# Command line

The CLI runs the engine in process. It talks to the same providers as the server and needs no server
running.

```bash
# from a clone
npm run build
node apps/cli/dist/index.js analyze 0xabc... 0xdef... --chains ethereum

# or, once published
npx sleuth analyze 0xabc... 0xdef...
```

## sleuth analyze

```
sleuth analyze <address...> [options]

  --chains <list>        Comma separated chains to search (default: ethereum,base,arbitrum,optimism,polygon,solana)
  --depth <n>            Transfers to read per address (default 400)
  --lookback <days>      Ignore activity older than this (default: no limit)
  --min-score <n>        Omit links below this score (default 15)
  --cluster-at <n>       Merge addresses into a cluster at this score (default 55)
  --signals <list>       Only run these signal ids
  --budget <seconds>     Wall clock budget for the whole analysis (default 120)
  --no-enrich            Skip shared counterparty resolution (faster, less accurate)
  --json                 Print the raw report as JSON
  --csv <edges|accounts> Print CSV instead of a report
  --graphml              Print GraphML instead of a report
  --out <file>           Write the output to a file instead of stdout
  --quiet                Suppress progress output on stderr
  -v, --verbose          Show every piece of evidence, not just the summary
```

Addresses may also be piped in:

```bash
cat wallets.txt | sleuth analyze --chains ethereum --json > report.json
```

Progress goes to stderr and the report to stdout, so redirecting output never mixes the two.

## sleuth signals

Prints the signal catalogue with weights and descriptions.

## sleuth chains

Prints the chain registry.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Analysis completed. Links may or may not have been found. |
| 1 | Unusable input, or the analysis failed. |
| 2 | Bad command line usage. |

The exit code deliberately does not depend on whether links were found: "no link" is a successful
analysis, and scripts that treat it as failure end up encouraging the wrong result.

## Environment

The CLI reads the same variables as the server. The two that matter most:

- `ETHERSCAN_API_KEY` makes EVM collection several times faster and deeper.
- `HELIUS_API_KEY` or `SOLANA_RPC_URLS` does the same for Solana.

See [providers](./providers.md).
