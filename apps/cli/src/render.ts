import { BANDS, shortAddress, type AnalysisReport, type LinkEdge } from '@braid/core';
import { bandStyle, bar, paint } from './theme.js';

function key(value: string): string {
  const idx = value.indexOf(':');
  return idx < 0 ? shortAddress(value) : `${value.slice(0, idx)}:${shortAddress(value.slice(idx + 1))}`;
}

/** The default human-readable report. */
export function renderReport(report: AnalysisReport, options: { verbose: boolean }): string {
  const out: string[] = [''];
  const { summary } = report;

  out.push(`  ${paint('BRAID', 'bold', 'cyan')} ${paint(`linkage report ${report.id.slice(0, 8)}`, 'dim')}`);
  out.push(
    paint(
      `  ${summary.addresses} addresses  ${summary.transfersAnalyzed} transfers  ${summary.chains.join(', ')}  ${(
        report.durationMs / 1000
      ).toFixed(1)}s`,
      'dim',
    ),
  );
  out.push('');

  if (report.edges.length === 0) {
    out.push(paint('  No links above the reporting threshold.', 'green'));
    out.push(
      paint(
        '  Nothing in the history read connects these addresses beyond what unrelated wallets share.',
        'dim',
      ),
    );
    out.push('');
  } else {
    out.push(paint('  LINKS', 'bold'));
    for (const edge of report.edges) {
      const style = bandStyle(edge.band);
      out.push(
        `  ${paint(bar(edge.score), style)} ${paint(String(edge.score).padStart(3), 'bold')} ${paint(
          edge.band.toUpperCase().padEnd(9),
          style,
        )} ${key(edge.a)} ${paint('<->', 'dim')} ${key(edge.b)}${edge.crossChain ? paint('  cross chain', 'dim') : ''}`,
      );
      out.push(paint(`      ${edge.signals.join(', ')}`, 'dim'));
      if (options.verbose) out.push(...renderEvidence(edge));
      out.push('');
    }
  }

  if (report.clusters.length > 0) {
    out.push(paint('  CLUSTERS', 'bold'));
    for (const cluster of report.clusters) {
      out.push(
        `  ${paint(cluster.id, 'cyan')} ${cluster.members.length} addresses  ${paint(
          `cohesion ${cluster.cohesion}, weakest link ${cluster.weakestLink}`,
          'dim',
        )}`,
      );
      for (const member of cluster.members) out.push(paint(`      ${key(member)}`, 'dim'));
      out.push(paint(`      ${cluster.rationale}`, 'dim'));
    }
    out.push('');
  }

  out.push(paint('  ADDRESSES', 'bold'));
  for (const account of report.accounts) {
    const tags = [
      account.label ? paint(account.label.name, 'yellow') : '',
      account.isContract ? paint('contract', 'dim') : '',
      account.delegated ? paint('7702 account', 'dim') : '',
      account.cluster ? paint(account.cluster, 'cyan') : '',
      account.historyComplete ? '' : paint('partial history', 'dim'),
    ].filter(Boolean);
    out.push(
      `  ${key(account.key).padEnd(26)} ${String(account.transfersAnalyzed).padStart(5)} transfers ${String(
        account.counterparties,
      ).padStart(5)} counterparties  ${tags.join(' ')}`,
    );
  }
  out.push('');

  if (options.verbose && report.hubs.length > 0) {
    out.push(paint('  IGNORED AS HUBS', 'bold'));
    for (const hub of report.hubs.slice(0, 12)) {
      out.push(paint(`  ${shortAddress(hub.address)}  ${hub.reason}`, 'dim'));
    }
    out.push('');
  }

  if (report.rejected.length > 0) {
    out.push(paint('  REJECTED INPUT', 'bold'));
    for (const item of report.rejected) out.push(paint(`  ${item.input}: ${item.reason}`, 'red'));
    out.push('');
  }

  if (report.warnings.length > 0) {
    out.push(paint('  CAVEATS', 'bold'));
    for (const warning of report.warnings) out.push(paint(`  - ${warning}`, 'yellow'));
    out.push('');
  }

  const top = report.edges[0];
  if (top) {
    const band = BANDS.find((entry) => entry.band === top.band);
    if (band) out.push(paint(`  ${band.label}: ${band.meaning}`, 'dim'), '');
  }

  return out.join('\n');
}

function renderEvidence(edge: LinkEdge): string[] {
  const out: string[] = [];
  for (const item of edge.evidence) {
    out.push(
      paint(`      ${item.title}`, 'bold') +
        paint(`  ${item.signal}, contributes ${(item.confidence * 100).toFixed(0)}%`, 'dim'),
    );
    out.push(paint(`        ${item.detail}`, 'dim'));
    for (const observation of item.observations) {
      out.push(paint(`        ${observation.label}: ${observation.value}`, 'dim'));
    }
    for (const reference of item.references.slice(0, 3)) {
      out.push(paint(`        ${reference.label}: ${reference.url ?? reference.value}`, 'dim'));
    }
  }
  return out;
}

/** Signal catalogue, for `braid signals`. */
export function renderSignals(
  signals: { id: string; title: string; category: string; weight: number; namespaces?: string[]; description: string }[],
): string {
  const out = ['', paint('  SIGNALS', 'bold', 'cyan'), ''];
  for (const signal of signals) {
    out.push(
      `  ${paint(signal.id.padEnd(24), 'bold')} ${paint(`weight ${signal.weight.toFixed(2)}`, 'cyan')}  ${paint(
        `${signal.category}, ${(signal.namespaces ?? ['evm', 'solana']).join(' + ')}`,
        'dim',
      )}`,
    );
    out.push(paint(`      ${wrap(signal.description, 92, '      ')}`, 'dim'), '');
  }
  return out.join('\n');
}

function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join(`\n${indent}`);
}
