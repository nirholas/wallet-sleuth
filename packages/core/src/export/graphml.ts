import type { AnalysisReport } from '../types.js';

function xml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * GraphML export, so a report opens directly in Gephi, yEd or Cytoscape Desktop.
 *
 * Investigators already have graph tooling; handing them a format those tools read is more useful
 * than asking them to re-enter the result by hand.
 */
export function toGraphml(report: AnalysisReport): string {
  const nodes = report.accounts
    .map(
      (account) => `    <node id="${xml(account.key)}">
      <data key="address">${xml(account.address)}</data>
      <data key="chain">${xml(account.chain)}</data>
      <data key="cluster">${xml(account.cluster ?? '')}</data>
      <data key="label">${xml(account.label?.name ?? '')}</data>
      <data key="transfers">${account.transfersAnalyzed}</data>
    </node>`,
    )
    .join('\n');

  const edges = report.edges
    .map(
      (edge, i) => `    <edge id="e${i}" source="${xml(edge.a)}" target="${xml(edge.b)}">
      <data key="score">${edge.score}</data>
      <data key="band">${xml(edge.band)}</data>
      <data key="signals">${xml(edge.signals.join(' '))}</data>
    </edge>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="address" for="node" attr.name="address" attr.type="string"/>
  <key id="chain" for="node" attr.name="chain" attr.type="string"/>
  <key id="cluster" for="node" attr.name="cluster" attr.type="string"/>
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="transfers" for="node" attr.name="transfers" attr.type="int"/>
  <key id="score" for="edge" attr.name="score" attr.type="int"/>
  <key id="band" for="edge" attr.name="band" attr.type="string"/>
  <key id="signals" for="edge" attr.name="signals" attr.type="string"/>
  <graph id="braid-${xml(report.id)}" edgedefault="undirected">
${nodes}
${edges}
  </graph>
</graphml>
`;
}
