import { describe, expect, it } from 'vitest';
import { accountsToCsv, edgesToCsv } from '../src/export/csv.js';
import { toGraphml } from '../src/export/graphml.js';
import { DEFAULT_OPTIONS } from '../src/analyze.js';
import type { AnalysisReport } from '../src/types.js';

const report: AnalysisReport = {
  id: 'test-id',
  version: '1.0.0',
  createdAt: '2026-01-01T00:00:00.000Z',
  durationMs: 1234,
  options: DEFAULT_OPTIONS,
  accounts: [
    {
      key: 'ethereum:0xa',
      chain: 'ethereum',
      address: '0xA',
      namespace: 'evm',
      label: { name: 'Exchange, Inc "hot"', kind: 'exchange', hub: true, source: 'test' },
      transfersAnalyzed: 10,
      counterparties: 4,
      inbound: 6,
      outbound: 4,
      truncated: false,
      historyComplete: true,
      unreadable: false,
      sanctioned: false,
      warnings: [],
      explorerUrl: 'https://etherscan.io/address/0xA',
      cluster: 'cluster-1',
    },
  ],
  edges: [
    {
      a: 'ethereum:0xa',
      b: 'ethereum:0xb',
      score: 82,
      band: 'strong',
      topSignal: 'direct-transfer',
      signals: ['direct-transfer'],
      crossChain: false,
      evidence: [
        {
          signal: 'direct-transfer',
          category: 'flow',
          a: 'ethereum:0xa',
          b: 'ethereum:0xb',
          strength: 0.9,
          weight: 0.75,
          confidence: 0.675,
          title: 'Value moved, with a "quote" & an ampersand',
          detail: '',
          observations: [],
          references: [],
        },
      ],
    },
  ],
  clusters: [],
  hubs: [],
  warnings: [],
  providers: [],
  flow: { nodes: [], edges: [], totalUsd: 0, unpricedAssets: [], trimmed: false, sanctionedNodes: [] },
  rejected: [],
  summary: { addresses: 1, linked: 2, clusters: 0, strongestScore: 82, transfersAnalyzed: 10, chains: ['ethereum'] },
};

describe('CSV export', () => {
  it('quotes fields containing separators and escapes embedded quotes', () => {
    const csv = edgesToCsv(report);
    const [header, row] = csv.split('\n');
    expect(header).toContain('address_a,address_b,score');
    expect(row).toContain('"direct-transfer: Value moved, with a ""quote"" & an ampersand"');
  });

  it('writes one account row with its cluster and label', () => {
    const csv = accountsToCsv(report);
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('cluster-1');
    expect(csv).toContain('"Exchange, Inc ""hot"""');
  });
});

describe('GraphML export', () => {
  it('emits well-formed XML with escaped attribute content', () => {
    const xml = toGraphml(report);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<node id="ethereum:0xa">');
    expect(xml).toContain('<edge id="e0" source="ethereum:0xa" target="ethereum:0xb">');
    expect(xml).toContain('Exchange, Inc &quot;hot&quot;');
    expect(xml.match(/<node /g)).toHaveLength(1);
  });
});
