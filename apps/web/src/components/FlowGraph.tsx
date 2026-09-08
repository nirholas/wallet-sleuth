import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { api } from '../lib/api';
import { shortAddress, usd, when } from '../lib/format';
import type { AnalysisReport, FlowEdge, FlowNode } from '../lib/types';

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
  // Expansion state lives here rather than in the report, because it is the reader's exploration of
  // the graph and should not pretend to be part of the analysis that was run.
  const [extraNodes, setExtraNodes] = useState<FlowNode[]>([]);
  const [extraEdges, setExtraEdges] = useState<FlowEdge[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [expanding, setExpanding] = useState<string | undefined>();
  const [expandError, setExpandError] = useState<string | undefined>();

  const flow = useMemo(() => {
    if (extraNodes.length === 0 && extraEdges.length === 0) return report.flow;
    const nodes = new Map(report.flow.nodes.map((node) => [node.id, node]));
    for (const node of extraNodes) if (!nodes.has(node.id)) nodes.set(node.id, node);
    const edges = new Map(report.flow.edges.map((edge) => [edge.id, edge]));
    for (const edge of extraEdges) if (!edges.has(edge.id)) edges.set(edge.id, edge);
    return {
      ...report.flow,
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      totalUsd: [...edges.values()].reduce((sum, edge) => sum + edge.usd, 0),
      sanctionedNodes: [...nodes.values()].filter((node) => node.sanctioned).map((node) => node.id),
    };
  }, [report.flow, extraNodes, extraEdges]);

  const expandNode = useCallback(
    async (node: FlowNode) => {
      if (expanded.has(node.id) || expanding) return;
      setExpanding(node.id);
      setExpandError(undefined);
      try {
        const result = await api.expand(node.chain, node.address);
        setExtraNodes((current) => [...current, ...result.flow.nodes]);
        setExtraEdges((current) => [...current, ...result.flow.edges]);
        setExpanded((current) => new Set(current).add(node.id));
        if (result.flow.edges.length === 0) {
          setExpandError(
            result.warnings[0] ?? 'No value movement could be read for that address at this depth.',
          );
        }
      } catch (err) {
        setExpandError((err as Error).message);
      } finally {
        setExpanding(undefined);
      }
    },
    [expanded, expanding],
  );
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
            sanctioned: node.sanctioned ? 1 : 0,
            expanded: expanded.has(node.id) ? 1 : 0,
            busy: expanding === node.id ? 1 : 0,
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
  }, [flow.nodes, visibleEdges, inputs, expanded, expanding]);

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
        // A sanctioned address is the one thing on this graph that must never be missed.
        {
          selector: 'node[sanctioned = 1]',
          style: { 'border-color': OUT, 'border-width': 4, 'background-color': OUT },
        },
        { selector: 'node[expanded = 1]', style: { 'border-color': '#ffffff', 'border-width': 3 } },
        { selector: 'node[busy = 1]', style: { 'border-color': '#a6a6a6', 'border-style': 'dashed', 'border-width': 3 } },
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
    cy.on('tap', 'node', (event) => {
      const node = flow.nodes.find((entry) => entry.id === (event.target.id() as string));
      if (node) void expandNode(node);
    });
    cy.on('tap', (event) => {
      if (event.target === cy) setSelected(undefined);
    });
    instance.current = cy;
    return () => {
      cy.destroy();
      instance.current = undefined;
    };
  }, [elements, flow.edges, flow.nodes, expandNode]);

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
        <div className="graph-hint">
          {expanding ? 'expanding...' : 'click a node to follow its money, an edge for detail'}
        </div>
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
          <span>
            <i style={{ background: OUT }} />
            sanctioned
          </span>
        </div>
      </div>

      {expandError ? (
        <p className="hint" style={{ marginTop: 10 }}>
          {expandError}
        </p>
      ) : null}
      {expanded.size > 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          {expanded.size} address{expanded.size === 1 ? '' : 'es'} expanded beyond the original analysis. Those
          hops were read on demand and were not scored by the linkage signals.{' '}
          <button
            type="button"
            className="linklike"
            onClick={() => {
              setExtraNodes([]);
              setExtraEdges([]);
              setExpanded(new Set());
            }}
          >
            Reset to the analysed set
          </button>
        </p>
      ) : null}

      {selected ? <FlowDetail edge={selected} nodes={flow.nodes} /> : null}

      <FlowList
        edges={visibleEdges}
        nodes={flow.nodes}
        expanded={expanded}
        expanding={expanding}
        selected={selected?.id}
        onSelect={setSelected}
        onExpand={expandNode}
      />

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

function nameFor(nodes: FlowNode[], id: string): string {
  const node = nodes.find((entry) => entry.id === id);
  return node?.label ?? shortAddress(node?.address ?? id, 6, 4);
}

/**
 * The same flows as a list.
 *
 * A canvas graph is unreachable by keyboard and invisible to a screen reader, so on its own it makes
 * the whole feature mouse-only. This carries identical information in a form that tabs, reads aloud,
 * and lets someone expand a specific counterparty without hunting for its dot.
 */
function FlowList({
  edges,
  nodes,
  expanded,
  expanding,
  selected,
  onSelect,
  onExpand,
}: {
  edges: FlowEdge[];
  nodes: FlowNode[];
  expanded: Set<string>;
  expanding: string | undefined;
  selected: string | undefined;
  onSelect(edge: FlowEdge): void;
  onExpand(node: FlowNode): void;
}) {
  const top = edges.slice(0, 25);
  return (
    <div style={{ marginTop: 16 }}>
      <h3 className="flow-list-heading">Largest flows</h3>
      <div className="table-scroll">
        <table>
          <caption className="sr-only">
            Value flows between the analysed addresses and their counterparties, largest first
          </caption>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">To</th>
              <th scope="col">Value</th>
              <th scope="col">Asset</th>
              <th scope="col">Transfers</th>
              <th scope="col">Follow</th>
            </tr>
          </thead>
          <tbody>
            {top.map((edge) => {
              const target = nodes.find((node) => node.id === edge.target);
              const source = nodes.find((node) => node.id === edge.source);
              const followable = [target, source].find(
                (node) => node && node.kind === 'counterparty' && !expanded.has(node.id),
              );
              return (
                <tr key={edge.id} className={selected === edge.id ? 'row-selected' : undefined}>
                  <td className="mono">
                    <button type="button" className="linklike" onClick={() => onSelect(edge)}>
                      {nameFor(nodes, edge.source)}
                    </button>
                    {source?.sanctioned ? <span className="chip tone-out">OFAC</span> : null}
                  </td>
                  <td className="mono">
                    {nameFor(nodes, edge.target)}
                    {target?.sanctioned ? <span className="chip tone-out">OFAC</span> : null}
                  </td>
                  <td>{edge.usd > 0 ? usd(edge.usd) : '-'}</td>
                  <td className="mono">{edge.asset}</td>
                  <td>{edge.transfers}</td>
                  <td>
                    {followable ? (
                      <button
                        type="button"
                        className="btn btn-tiny"
                        disabled={Boolean(expanding)}
                        onClick={() => onExpand(followable)}
                      >
                        {expanding === followable.id ? 'reading...' : 'follow'}
                      </button>
                    ) : (
                      <span className="hint" style={{ margin: 0 }}>
                        {expanded.has(edge.target) || expanded.has(edge.source) ? 'followed' : 'analysed'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {edges.length > top.length ? (
        <p className="hint">
          Showing the {top.length} largest of {edges.length}. The rest are in the graph and the JSON export.
        </p>
      ) : null}
    </div>
  );
}

function FlowDetail({ edge, nodes }: { edge: FlowEdge; nodes: FlowNode[] }) {
  const nameOf = (id: string) => nameFor(nodes, id);
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
