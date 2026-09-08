import { useEffect, useMemo, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { labelKey, splitKey } from '../lib/format';
import type { AnalysisReport } from '../lib/types';

const CLUSTER_COLORS = ['#5eead4', '#a78bfa', '#f472b6', '#fbbf24', '#60a5fa', '#34d399', '#fb923c'];

const BAND_COLOR: Record<string, string> = {
  confirmed: '#f87171',
  strong: '#fb923c',
  moderate: '#fbbf24',
  weak: '#3f5163',
  none: '#2b3b4a',
};

interface Props {
  report: AnalysisReport;
  selected?: string;
  onSelect(edgeId: string | undefined): void;
}

/**
 * Force-directed view of the analysed addresses.
 *
 * Node colour is the cluster, edge colour is the confidence band and edge width is the score, so
 * the shape of a result is readable before a single label is. Selecting an edge here drives the
 * evidence list below, which is the whole point: the graph is for orientation, the evidence is the
 * answer.
 */
export function Graph({ report, selected, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<Core>();

  const elements = useMemo<ElementDefinition[]>(() => {
    const clusterIndex = new Map(report.clusters.map((cluster, i) => [cluster.id, i]));
    const nodes: ElementDefinition[] = report.accounts.map((account) => ({
      data: {
        id: account.key,
        label: labelKey(account.key),
        color: account.cluster
          ? (CLUSTER_COLORS[(clusterIndex.get(account.cluster) ?? 0) % CLUSTER_COLORS.length] as string)
          : '#4b5b6b',
        size: 20 + Math.min(26, Math.sqrt(account.transfersAnalyzed + 1) * 2.2),
        service: account.label ? 1 : 0,
      },
    }));
    const edges: ElementDefinition[] = report.edges.map((edge) => ({
      data: {
        id: `${edge.a}|${edge.b}`,
        source: edge.a,
        target: edge.b,
        score: edge.score,
        width: 1 + (edge.score / 100) * 6,
        color: BAND_COLOR[edge.band] ?? '#2b3b4a',
        dashed: edge.crossChain ? 1 : 0,
      },
    }));
    return [...nodes, ...edges];
  }, [report]);

  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#93a4b3',
            'font-size': 9,
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'border-width': 2,
            'border-color': '#080a0f',
            'transition-property': 'border-color, background-color',
            'transition-duration': 150,
          },
        },
        {
          selector: 'node[service = 1]',
          style: { 'border-color': '#fbbf24', 'border-width': 2, shape: 'round-diamond' },
        },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            'curve-style': 'bezier',
            opacity: 0.75,
            label: 'data(score)',
            'font-size': 8,
            color: '#64758a',
            'text-background-color': '#080a0f',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
          },
        },
        { selector: 'edge[dashed = 1]', style: { 'line-style': 'dashed' } },
        { selector: 'edge.selected', style: { opacity: 1, width: 'data(width)', 'line-color': '#5eead4' } },
        { selector: 'node.dim, edge.dim', style: { opacity: 0.15 } },
      ],
      layout: {
        name: 'cose',
        animate: false,
        nodeRepulsion: () => 12000,
        idealEdgeLength: () => 110,
        padding: 40,
      },
    });

    cy.on('tap', 'edge', (event) => onSelect(event.target.id() as string));
    cy.on('tap', (event) => {
      if (event.target === cy) onSelect(undefined);
    });
    instance.current = cy;
    return () => {
      cy.destroy();
      instance.current = undefined;
    };
  }, [elements, onSelect]);

  useEffect(() => {
    const cy = instance.current;
    if (!cy) return;
    cy.elements().removeClass('selected dim');
    if (!selected) return;
    const edge = cy.getElementById(selected);
    if (edge.empty()) return;
    edge.addClass('selected');
    const keep = edge.union(edge.connectedNodes());
    cy.elements().difference(keep).addClass('dim');
  }, [selected]);

  if (report.accounts.length === 0) return null;

  return (
    <div className="graph-wrap">
      <div ref={container} style={{ width: '100%', height: '100%' }} role="img" aria-label="Linkage graph" />
      <div className="graph-hint">drag to pan, scroll to zoom, click an edge</div>
      <div className="graph-legend">
        <span>
          <i style={{ background: BAND_COLOR.confirmed }} />
          confirmed
        </span>
        <span>
          <i style={{ background: BAND_COLOR.strong }} />
          strong
        </span>
        <span>
          <i style={{ background: BAND_COLOR.moderate }} />
          moderate
        </span>
        <span>
          <i style={{ background: BAND_COLOR.weak }} />
          weak
        </span>
        <span>dashed = cross chain</span>
        <span>diamond = known service</span>
      </div>
    </div>
  );
}

export function graphNodeLabel(key: string): string {
  const { chain, address } = splitKey(key);
  return `${chain} ${address}`;
}
