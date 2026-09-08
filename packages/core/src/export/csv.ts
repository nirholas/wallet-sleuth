import type { AnalysisReport } from '../types.js';

function escape(value: string | number | undefined | null): string {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per scored edge, with the evidence flattened into a readable column. */
export function edgesToCsv(report: AnalysisReport): string {
  const header = ['address_a', 'address_b', 'score', 'band', 'cross_chain', 'signals', 'top_signal', 'evidence'];
  const rows = report.edges.map((edge) =>
    [
      edge.a,
      edge.b,
      edge.score,
      edge.band,
      edge.crossChain ? 'yes' : 'no',
      edge.signals.join(' '),
      edge.topSignal,
      edge.evidence.map((item) => `${item.signal}: ${item.title}`).join(' | '),
    ]
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

/** One row per analysed address. */
export function accountsToCsv(report: AnalysisReport): string {
  const header = [
    'key',
    'chain',
    'address',
    'cluster',
    'label',
    'is_contract',
    'balance',
    'transfers_analyzed',
    'counterparties',
    'first_activity',
    'last_activity',
    'truncated',
  ];
  const rows = report.accounts.map((account) =>
    [
      account.key,
      account.chain,
      account.address,
      account.cluster ?? '',
      account.label?.name ?? '',
      account.isContract ? 'yes' : 'no',
      account.balance ?? '',
      account.transfersAnalyzed,
      account.counterparties,
      account.firstActivity ? new Date(account.firstActivity * 1000).toISOString() : '',
      account.lastActivity ? new Date(account.lastActivity * 1000).toISOString() : '',
      account.truncated ? 'yes' : 'no',
    ]
      .map(escape)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}
