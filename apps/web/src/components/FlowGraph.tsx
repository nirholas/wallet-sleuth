import { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { shortAddress, usd, when } from '../lib/format';
import type { AnalysisReport, FlowEdge } from '../lib/types';

/**
 * Where the value actually went.
 *
 * The linkage graph shows what Wallet Sleuth inferred; this shows what happened. Nodes are the
 * analysed addresses and the counterparties that carry real value, edges are directed and weighted
 * by USD, and the two product colours do their one job: an edge paying into an analysed address is
 * green, an edge paying out of one is red, and movement between two analysed addresses is white
 * because it is internal and neither.
 *
 * Edge width is the log of value, not value itself. A linear scale on a set spanning six orders of
 * magnitude draws one visible edge and a hundred hairlines, which hides exactly the mid-sized flows
 * an investigator is looking for.
 */
const IN = '#22c55e';
const OUT = '#ef4444';
const INTERNAL = '#ffffff';

interface Props {
  report: AnalysisReport;
}

function edgeWidth(edgeUsd: number, transfers: number, max: number): number {
  if (edgeUsd <= 0 || max <= 0) return 1 + Math.min(3, transfers * 0.4);
  const ratio = Math.log10(1 + edgeUsd) / Math.log10(1 + max);
  return 1.2 + ratio * 8;
}

export function FlowGraph({ report }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<Core>();
  const [selected, setSelected] = useState<FlowEdge | undefined>();
  const [minUsd, setMinUsd] = useState(0);

  const flow = report.flow;
  const inputs = useMemo(() => new Set(flow.nodes.filter((n) => n.kind === 'input').map((n) => n.id)), [flow]);

  const visibleEdges = useMemo(
    () => flow.edges.filter((edge) => edge.usd >= minUsd || (minUsd === 0 && edge.usd === 0)),
    [flow.edges, minUsd],
  );

  const elements = useMemo<ElementDefinition[]>(() => {
    const maxUsd = Math.max(...visibleEdges.map((edge) => edge.usd), 0);
    const live = new Set<string>();
    for (const edge of visibleEdges) {
      live.add(edge.source);
      live.add(edge.target);
    }
    const nodes: ElementDefinition[] = flow.nodes
      .filter((node) => live.has(node.id))
      .map((node) => {
        const total = node.usdIn + node.usdOut;
        return {
          data: {
            id: node.id,
            label: node.label ?? shortAddress(node.address, 5, 4),
            sub: total > 0 ? usd(total) : `${node.transfers} tx`,
            size: 18 + Math.min(30, Math.log10(1 + total) * 5),
            input: node.kind === 'input' ? 1 : 0,
            service: node.service ? 1 : 0,
          },
        };
      });
    const edges: ElementDefinition[] = visibleEdges.map((edge) => {
      const intoInput = inputs.has(edge.target);
      const outOfInput = inputs.has(edge.source);
      const color = intoInput && outOfInput ? INTERNAL : intoInput ? IN : OUT;
      return {
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          color,
          width: edgeWidth(edge.usd, edge.transfers, maxUsd),
          label: edge.usd > 0 ? `${usd(edge.usd)} ${edge.asset}` : `${edge.transfers}x ${edge.asset}`,
        },
      };
    });
    return [...nodes, ...edges];
  }, [flow.nodes, visibleEdges, inputs]);

  useEffect(() => {
    if (!container.current) return;
    const cy = cytoscape({
      container: container.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#0e0e0e',
            'border-color': '#5c5c5c',
            'border-width': 1.5,
            width: 'data(size)',
            height: 'data(size)',
            label: 'data(label)',
            color: '#ffffff',
            'font-size': 10,
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'bottom',
            'text-margin-y': 5,
            'text-background-color': '#000000',
            'text-background-opacity': 0.8,
            'text-background-padding': '2px',
          },
        },
        { selector: 'node[input = 1]', style: { 'background-color': '#ffffff', 'border-color': '#ffffff' } },
        { selector: 'node[service = 1]', style: { shape: 'round-diamond', 'border-color': '#a6a6a6' } },
        {
          selector: 'edge',
          style: {
            width: 'data(width)',
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.9,
            'curve-style': 'bezier',
            opacity: 0.85,
            label: 'data(label)',
            'font-size': 8,
            color: '#a6a6a6',
            'text-background-color': '#000000',
            'text-background-opacity': 0.85,
            'text-background-padding': '2px',
            'text-rotation': 'autorotate',
          },
        },
        { selector: 'edge.selected', style: { opacity: 1, 'line-style': 'solid', color: '#ffffff' } },
        { selector: '.dim', style: { opacity: 0.12 } },
      ],
      layout: { name: 'cose', animate: false, nodeRepulsion: () => 20000, idealEdgeLength: () => 130, padding: 45 },
      wheelSensitivity: 0.3,
    });

    cy.on('tap', 'edge', (event) => {
      const id = event.target.id() as string;
      setSelected(flow.edges.find((edge) => edge.id === id));
    });
    cy.on('tap', (event) => {
      if (event.target === cy) setSelected(undefined);
    });
    instance.current = cy;
    return () => {
      cy.destroy();
      instance.current = undefined;
    };
  }, [elements, flow.edges]);

  useEffect(() => {
    const cy = instance.current;
    if (!cy) return;
    cy.elements().removeClass('selected dim');
    if (!selected) return;
    const edge = cy.getElementById(selected.id);
    if (edge.empty()) return;
    edge.addClass('selected');
    cy.elements().difference(edge.union(edge.connectedNodes())).addClass('dim');
  }, [selected]);

  if (flow.edges.length === 0) {
    return (
      <div className="empty">
        <h3>No value movement to draw</h3>
        <p>
          None of the analysed addresses moved value to or from anything in the history that was read. Raise the
          history depth in advanced settings, or check the caveats for coverage gaps.
        </p>
      </div>
    );
  }

  const maxEdgeUsd = Math.max(...flow.edges.map((edge) => edge.usd), 0);

  return (
    <>
      <div className="flow-toolbar">
        <span>
          <b>{usd(flow.totalUsd)}</b> across {flow.edges.length} flows
        </span>
        <label htmlFor="min-usd">
          Hide flows under {minUsd > 0 ? usd(minUsd) : 'nothing'}
        </label>
        <input
          id="min-usd"
          type="range"
          min={0}
          max={Math.max(1, Math.floor(Math.log10(1 + maxEdgeUsd) * 100))}
          value={Math.floor(Math.log10(1 + minUsd) * 100)}
          onChange={(event) => {
            const raw = Number(event.target.value);
            setMinUsd(raw === 0 ? 0 : 10 ** (raw / 100) - 1);
          }}
        />
        <span className="hint" style={{ margin: 0 }}>
          {visibleEdges.length} shown
        </span>
      </div>

      <div className="graph-wrap">
        <div ref={container} style={{ width: '100%', height: '100%' }} role="img" aria-label="Value flow graph" />
        <div className="graph-hint">drag to pan, scroll to zoom, click a flow</div>
        <div className="graph-legend">
          <span>
            <i style={{ background: IN }} />
            into an analysed address
          </span>
          <span>
            <i style={{ background: OUT }} />
            out of one
          </span>
          <span>
            <i style={{ background: INTERNAL }} />
            between two
          </span>
          <span>width = value (log)</span>
          <span>diamond = known service</span>
        </div>
      </div>

      {selected ? <FlowDetail edge={selected} report={report} /> : null}

      {flow.unpricedAssets.length > 0 ? (
        <p className="hint" style={{ marginTop: 12 }}>
          {flow.unpricedAssets.length} asset{flow.unpricedAssets.length === 1 ? '' : 's'} could not be valued by
          the keyless price source, so {flow.unpricedAssets.length === 1 ? 'its' : 'their'} edges are sized by
          transfer count instead of dollars. Nothing was hidden.
        </p>
      ) : null}
      {flow.trimmed ? (
        <p className="hint">
          Only the largest flows are drawn, to keep the graph readable. The full set is in the JSON export.
        </p>
      ) : null}
    </>
  );
}

function FlowDetail({ edge, report }: { edge: FlowEdge; report: AnalysisReport }) {
  const nameOf = (id: string) => {
    const node = report.flow.nodes.find((entry) => entry.id === id);
    return node?.label ?? shortAddress(node?.address ?? id, 6, 4);
  };
  return (
    <div className="cluster" style={{ padding: '12px 14px', marginTop: 12 }}>
      <strong className="mono">
        {nameOf(edge.source)} &#8594; {nameOf(edge.target)}
      </strong>
      <div className="obs" style={{ marginTop: 8 }}>
        <span>
          <b>Value:</b> {edge.usd > 0 ? usd(edge.usd) : 'not priced'}
        </span>
        <span>
          <b>Asset:</b> {edge.asset}
        </span>
        <span>
          <b>Transfers:</b> {edge.transfers}
        </span>
        <span>
          <b>Window:</b> {when(edge.firstTs)} to {when(edge.lastTs)}
        </span>
      </div>
      <div className="refs">
        {edge.samples.map((sample, i) => (
          <a key={sample.hash} href={sample.url} target="_blank" rel="noreferrer noopener">
            {sample.usd !== undefined ? usd(sample.usd) : `transfer ${i + 1}`} &#8599;
          </a>
        ))}
      </div>
      {edge.partialValue && edge.usd > 0 ? (
        <p className="hint" style={{ margin: '8px 0 0' }}>
          Some transfers on this flow carry an asset the price source does not cover, so the total is a floor,
          not the whole amount.
        </p>
      ) : null}
    </div>
  );
}
