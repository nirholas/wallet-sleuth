#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import {
  accountsToCsv,
  ALL_SIGNALS,
  analyze,
  BraidError,
  edgesToCsv,
  listChains,
  MAX_ADDRESSES,
  toGraphml,
  VERSION,
  type AnalysisOptions,
} from '@braid/core';
import { flagList, flagNumber, flagString, parseArgs } from './args.js';
import { renderReport, renderSignals } from './render.js';
import { paint } from './theme.js';

const USAGE = `
  ${paint('braid', 'bold', 'cyan')} ${paint('- wallet linkage analysis for EVM and Solana', 'dim')}

  ${paint('Usage', 'bold')}
    braid analyze <address...> [options]
    braid signals
    braid chains

  ${paint('Options', 'bold')}
    --chains <list>          Chains to search (default: the registry defaults)
    --depth <n>              Transfers to read per address (default 400)
    --lookback <days>        Ignore activity older than this (default: no limit)
    --min-score <n>          Omit links scoring below this (default 15)
    --cluster-at <n>         Merge addresses into a cluster at this score (default 55)
    --signals <list>         Only run these signal ids
    --budget <seconds>       Wall clock budget for the analysis (default 120)
    --no-enrich              Skip shared counterparty resolution
    --json                   Print the raw report as JSON
    --csv <edges|accounts>   Print CSV instead of a report
    --graphml                Print GraphML instead of a report
    --out <file>             Write to a file instead of stdout
    -q, --quiet              No progress output
    -v, --verbose            Show every piece of evidence
    -h, --help               This message

  ${paint('Examples', 'bold')}
    braid analyze 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B --chains ethereum
    braid analyze 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM 5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9 -v
    cat wallets.txt | braid analyze --json --out report.json

  Addresses may be piped in on stdin. Progress goes to stderr, output to stdout.
  Docs: https://github.com/braid-tools/braid
`;

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function emit(text: string, out: string | undefined): void {
  if (out) {
    writeFileSync(out, text.endsWith('\n') ? text : `${text}\n`);
    process.stderr.write(paint(`wrote ${out}\n`, 'dim'));
    return;
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  const { flags } = parsed;

  if (flags.has('version')) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (flags.has('help') || !parsed.command) {
    process.stdout.write(`${USAGE}\n`);
    return parsed.command ? 0 : 2;
  }

  if (parsed.command === 'signals') {
    emit(
      flags.has('json')
        ? JSON.stringify(
            ALL_SIGNALS.map((signal) => ({
              id: signal.id,
              title: signal.title,
              category: signal.category,
              weight: signal.weight,
              namespaces: signal.namespaces ?? ['evm', 'solana'],
              description: signal.description,
            })),
            null,
            2,
          )
        : renderSignals(
            ALL_SIGNALS.map((signal) => ({
              id: signal.id,
              title: signal.title,
              category: signal.category,
              weight: signal.weight,
              namespaces: signal.namespaces,
              description: signal.description,
            })),
          ),
      flagString(flags, 'out'),
    );
    return 0;
  }

  if (parsed.command === 'chains') {
    const chains = listChains();
    emit(
      flags.has('json')
        ? JSON.stringify(chains, null, 2)
        : chains
            .map(
              (chain) =>
                `  ${chain.slug.padEnd(12)} ${chain.name.padEnd(20)} ${chain.namespace.padEnd(7)} ${
                  chain.evmChainId ? `chain id ${chain.evmChainId}` : ''
                }${chain.default ? paint('  default', 'dim') : ''}`,
            )
            .join('\n'),
      flagString(flags, 'out'),
    );
    return 0;
  }

  if (parsed.command !== 'analyze') {
    process.stderr.write(paint(`unknown command "${parsed.command}"\n`, 'red'));
    process.stdout.write(`${USAGE}\n`);
    return 2;
  }

  const piped = await readStdin();
  const addresses = [...parsed.positionals, ...piped.split(/[\s,;]+/)].map((v) => v.trim()).filter(Boolean);

  if (addresses.length < 2) {
    process.stderr.write(paint('braid needs at least two addresses to compare\n', 'red'));
    return 1;
  }
  if (addresses.length > MAX_ADDRESSES) {
    process.stderr.write(
      paint(`too many addresses: ${addresses.length} supplied, ${MAX_ADDRESSES} is the maximum\n`, 'red'),
    );
    return 1;
  }

  const options: Partial<AnalysisOptions> = {};
  const depth = flagNumber(flags, 'depth');
  if (depth !== undefined) options.maxTransfersPerAddress = depth;
  const lookback = flagNumber(flags, 'lookback');
  if (lookback !== undefined) options.lookbackDays = lookback;
  const minScore = flagNumber(flags, 'min-score');
  if (minScore !== undefined) options.minScore = minScore;
  const clusterAt = flagNumber(flags, 'cluster-at');
  if (clusterAt !== undefined) options.clusterThreshold = clusterAt;
  const budget = flagNumber(flags, 'budget');
  if (budget !== undefined) options.budgetMs = Math.round(budget * 1000);
  const signals = flagList(flags, 'signals');
  if (signals) options.signals = signals;
  if (flags.has('no-enrich')) options.enrichCounterparties = false;

  const quiet = flags.has('quiet');
  const report = await analyze(
    { addresses, chains: flagList(flags, 'chains'), options },
    {
      onProgress: (event) => {
        if (quiet) return;
        process.stderr.write(paint(`  [${event.phase}] ${event.message}\n`, 'dim'));
      },
    },
  );

  const out = flagString(flags, 'out');
  if (flags.has('json')) emit(JSON.stringify(report, null, 2), out);
  else if (flags.has('graphml')) emit(toGraphml(report), out);
  else if (flags.has('csv')) {
    const which = flagString(flags, 'csv');
    emit(which === 'accounts' ? accountsToCsv(report) : edgesToCsv(report), out);
  } else emit(renderReport(report, { verbose: flags.has('verbose') }), out);

  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    if (err instanceof BraidError) {
      process.stderr.write(paint(`${err.code}: ${err.message}\n`, 'red'));
      if (err.details) process.stderr.write(paint(`${JSON.stringify(err.details, null, 2)}\n`, 'dim'));
      process.exit(1);
    }
    process.stderr.write(paint(`${(err as Error).message}\n`, 'red'));
    process.exit(1);
  });
