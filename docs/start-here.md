# Start here

Braid answers one question: **do these wallet addresses belong together?**

You give it a list of public addresses, on any mix of supported EVM chains and Solana. It reads their
real on-chain history, runs fourteen linkage signals over that history, and returns a score for every
pair along with the exact transactions behind each score.

It is not an identity tool. Braid never tells you *who* owns an address, because public chain data
does not contain that. It tells you which addresses behave as though one operator is behind them, and
it shows its work so you can judge for yourself.

## Sixty seconds to a first result

```bash
git clone https://github.com/braid-tools/braid.git
cd braid
npm install
npm run build
npm start
```

Open <http://localhost:8787>, paste two addresses, run the analysis. No API key, no account, no
configuration. Braid reads from keyless public endpoints out of the box.

From the command line:

```bash
npx braid analyze \
  0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 \
  0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B \
  --chains ethereum
```

From the HTTP API:

```bash
curl -s http://localhost:8787/v1/analyze \
  -H 'content-type: application/json' \
  -d '{"addresses":["9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM","5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9"],"wait":true}'
```

## What you get back

A report with four parts:

**Links.** Every pair of addresses that scored above the reporting threshold, with a score from 0 to
100, a confidence band, and the evidence list. Each piece of evidence names the signal that fired,
explains in plain language what it means, and links to the transactions on a block explorer.

**Clusters.** Addresses merged into groups when their links clear the clustering threshold.
Membership is transitive: A and C can share a cluster because both link to B, even if A and C never
touched. The report always tells you the weakest edge holding a cluster together, so a transitive
merge is never hidden inside a single number.

**Addresses.** What Braid actually read for each address: how many transfers, how many
counterparties, the date range, and whether it saw the account's complete history or only a sample.

**Caveats.** Everything that could make the result wrong: truncated history, rate limited providers,
input addresses that are known services, signals withheld for lack of data. Read this section. It is
the difference between a number and a finding.

## Where to go next

- [How it works](./how-it-works.md): the pipeline, end to end.
- [Signals](./signals.md): all fourteen, what each proves and how each can be wrong.
- [Scoring](./scoring.md): how evidence becomes a number, and why it is not a sum.
- [Interpreting results](./interpreting-results.md): what a score of 62 actually licenses you to say.
- [API](./api.md), [CLI](./cli.md), [Self-hosting](./self-hosting.md), [Providers](./providers.md).
- [Privacy and ethics](./privacy-and-ethics.md): what this tool is not for.
