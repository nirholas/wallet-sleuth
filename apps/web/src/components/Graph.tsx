import { useEffect, useMemo, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { labelKey, splitKey } from '../lib/format';
import type { AnalysisReport } from '../lib/types';

/**
 * Clusters are told apart by brightness, not by hue.
 *
 * Colour in this product means one thing, the direction value moved, so a cluster palette would
 * spend the only signal colour carries on something that is not about value at all. Brightness plus
 * the service diamond carries the same information without that cost.
 */
const CLUSTER_SHADES = ['#ffffff', '#c9c9c9', '#9a9a9a', '#787878', '#5e5e5e', '#4a4a4a', '#3a3a3a'];

/** Confidence bands ride the same ramp: brighter is stronger. */
const BAND_COLOR: Record<string, string> = {
  confirmed: '#ffffff',
  strong: '#cfcfcf',
  moderate: '#8f8f8f',
  weak: '#5c5c5c',
  none: '#3a3a3a',
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
          ? (CLUSTER_SHADES[(clusterIndex.get(account.cluster) ?? 0) % CLUSTER_SHADES.length] as string)
          : '#3a3a3a',
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
            color: '#a6a6a6',
            'font-size': 9,
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'border-width': 2,
            'border-color': '#000000',
            'transition-property': 'border-color, background-color',
            'transition-duration': 150,
          },
        },
        {
          selector: 'node[service = 1]',
          style: { 'border-color': '#ffffff', 'border-width': 3, shape: 'round-diamond' },
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
            color: '#8f8f8f',
            'text-background-color': '#000000',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
          },
        },
        { selector: 'edge[dashed = 1]', style: { 'line-style': 'dashed' } },
        { selector: 'edge.selected', style: { opacity: 1, width: 'data(width)', 'line-color': '#ffffff' } },
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
        <span>brightness = cluster</span>
      </div>
    </div>
  );
}

export function graphNodeLabel(key: string): string {
  const { chain, address } = splitKey(key);
  return `${chain} ${address}`;
}
