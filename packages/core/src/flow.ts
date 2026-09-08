import { addressKey, shortAddress } from './address.js';
import { addressUrl, txUrl } from './chains.js';
import { labels } from './labels/index.js';
import { formatUsd, type PriceBook } from './prices.js';
import type { NameBook } from './names.js';
import type { ActivityBundle, Cluster, Transfer } from './types.js';

/**
 * The value flow graph.
 *
 * This is a different question from the linkage graph and deserves its own picture. The linkage
 * graph answers "which of these addresses are related, and how confident are we"; the flow graph
 * answers "where did the money actually go". Investigators read the second one first, because value
 * and direction are facts off the chain while a linkage score is an inference on top of them.
 *
 * Nodes are the analysed addresses plus the counterparties that carry real value. Edges are directed
 * and aggregated per pair, weighted by USD where a price exists and by transfer count where it does
 * not, so an unpriced token never silently disappears from the picture.
 */
export interface FlowNode {
  id: string;
  chain: string;
  address: string;
  /** `input` is an address the caller asked about; `counterparty` was discovered in its history. */
  kind: 'input' | 'counterparty';
  /** Entity name, ENS or `.sol` domain, when one is known. */
  label?: string;
  /** Kind of service, when the address is a labelled one. */
  service?: string;
  isContract: boolean;
  /** Cluster id when the node is an analysed address that joined one. */
  cluster: string | null;
  usdIn: number;
  usdOut: number;
  transfers: number;
  explorerUrl: string;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  transfers: number;
  /** Total USD across the edge, when every leg could be priced. */
  usd: number;
  /** True when at least one transfer on this edge had no price. */
  partialValue: boolean;
  /** Human label for the dominant asset, e.g. `SOL` or `USDC`. */
  asset: string;
  firstTs: number;
  lastTs: number;
  /** A few transactions a reader can open to check the edge. */
  samples: { hash: string; url: string; value: number; usd?: number }[];
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  /** Total USD moved across every edge drawn. */
  totalUsd: number;
  /** Assets no keyless price source could value, so the picture states what it is missing. */
  unpricedAssets: string[];
  /** True when edges were dropped to keep the graph readable. */
  trimmed: boolean;
}

export interface BuildFlowOptions {
  /** Maximum edges to draw. Beyond this the picture stops being readable. */
  maxEdges: number;
  /** Counterparties below this USD value are folded away unless they carry several transfers. */
  minUsd: number;
}

export const DEFAULT_FLOW_OPTIONS: BuildFlowOptions = { maxEdges: 120, minUsd: 1 };

interface EdgeAccumulator {
  transfers: Transfer[];
  usd: number;
  priced: number;
  assets: Map<string, number>;
}

function assetLabel(transfer: Transfer, names: NameBook): string {
  if (transfer.asset.kind === 'native') return transfer.asset.symbol ?? 'native';
  if (transfer.asset.symbol) return transfer.asset.symbol;
  if (transfer.asset.address) {
    return names.symbol(transfer.asset.address) ?? shortAddress(transfer.asset.address, 4, 4);
  }
  return 'token';
}

export function buildFlow(
  bundles: ActivityBundle[],
  clusters: Cluster[],
  prices: PriceBook,
  names: NameBook,
  options: BuildFlowOptions = DEFAULT_FLOW_OPTIONS,
): FlowGraph {
  const registry = labels();
  const inputs = new Set(bundles.map((bundle) => bundle.ref.key));
  const clusterOf = new Map<string, string>();
  for (const cluster of clusters) for (const member of cluster.members) clusterOf.set(member, cluster.id);

  const edges = new Map<string, EdgeAccumulator>();
  const seen = new Set<string>();

  for (const bundle of bundles) {
    for (const transfer of bundle.transfers) {
      if (!transfer.success || transfer.value <= 0) continue;
      const from = addressKey(transfer.chain, transfer.from);
      const to = addressKey(transfer.chain, transfer.to);
      if (from === to) continue;
      // Only draw an edge the caller's own addresses are party to. Third-party legs that happened to
      // ride along in the same transaction are context, not this account's flow.
      if (!inputs.has(from) && !inputs.has(to)) continue;

      const id = `${from}->${to}`;
      // The same transfer appears in both parties' bundles when both were analysed.
      const fingerprint = `${id}|${transfer.txHash}|${transfer.rawValue}|${transfer.index}`;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const entry: EdgeAccumulator =
        edges.get(id) ?? { transfers: [], usd: 0, priced: 0, assets: new Map<string, number>() };
      entry.transfers.push(transfer);
      const usd = prices.usd(transfer);
      if (usd !== undefined) {
        entry.usd += usd;
        entry.priced += 1;
      }
      const asset = assetLabel(transfer, names);
      entry.assets.set(asset, (entry.assets.get(asset) ?? 0) + (usd ?? 0));
      edges.set(id, entry);
    }
  }

  const ranked = [...edges.entries()]
    .map(([id, entry]) => {
      const [source, target] = id.split('->') as [string, string];
      const timestamps = entry.transfers.map((t) => t.ts).filter((ts) => ts > 0);
      const dominant = [...entry.assets.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'value';
      const samples = entry.transfers
        .slice()
        .sort((a, b) => (prices.usd(b) ?? b.value) - (prices.usd(a) ?? a.value))
        .slice(0, 4)
        .map((t) => ({ hash: t.txHash, url: txUrl(t.chain, t.txHash), value: t.value, usd: prices.usd(t) }));
      return {
        id,
        source,
        target,
        transfers: entry.transfers.length,
        usd: entry.usd,
        partialValue: entry.priced < entry.transfers.length,
        asset: dominant,
        firstTs: timestamps.length > 0 ? Math.min(...timestamps) : 0,
        lastTs: timestamps.length > 0 ? Math.max(...timestamps) : 0,
        samples,
      } satisfies FlowEdge;
    })
    // Rank by value, falling back to activity so an unpriced but busy edge is never invisible.
    .sort((a, b) => b.usd - a.usd || b.transfers - a.transfers)
    .filter((edge) => edge.usd >= options.minUsd || edge.transfers > 1 || edge.usd === 0);

  const kept = ranked.slice(0, options.maxEdges);
  const trimmed = kept.length < ranked.length;

  const nodes = new Map<string, FlowNode>();
  const ensure = (key: string) => {
    const existing = nodes.get(key);
    if (existing) return existing;
    const idx = key.indexOf(':');
    const chain = key.slice(0, idx);
    const address = key.slice(idx + 1);
    const bundle = bundles.find((entry) => entry.ref.key === key);
    const label = registry.lookup(chain, address);
    const node: FlowNode = {
      id: key,
      chain,
      address: bundle?.ref.address ?? address,
      kind: inputs.has(key) ? 'input' : 'counterparty',
      label: label?.name ?? bundle?.facts.name ?? names.domain(address),
      service: label?.kind,
      isContract: bundle?.facts.isContract === true,
      cluster: clusterOf.get(key) ?? null,
      usdIn: 0,
      usdOut: 0,
      transfers: 0,
      explorerUrl: addressUrl(chain, bundle?.ref.address ?? address),
    };
    nodes.set(key, node);
    return node;
  };

  let totalUsd = 0;
  for (const edge of kept) {
    const source = ensure(edge.source);
    const target = ensure(edge.target);
    source.usdOut += edge.usd;
    target.usdIn += edge.usd;
    source.transfers += edge.transfers;
    target.transfers += edge.transfers;
    totalUsd += edge.usd;
  }

  return {
    nodes: [...nodes.values()].sort((a, b) => b.usdOut + b.usdIn - (a.usdOut + a.usdIn)),
    edges: kept,
    totalUsd,
    unpricedAssets: prices.unpriced.slice(0, 20),
    trimmed,
  };
}

/** One-line description of an edge, used in tooltips and the CLI. */
export function describeEdge(edge: FlowEdge): string {
  const value = edge.usd > 0 ? formatUsd(edge.usd) : `${edge.transfers} transfer${edge.transfers === 1 ? '' : 's'}`;
  return `${value} in ${edge.asset}${edge.partialValue && edge.usd > 0 ? ' (partly unpriced)' : ''}`;
}
