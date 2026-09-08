import { shortAddress } from './address.js';
import { UnionFind } from './util/unionfind.js';
import type { Cluster, LinkEdge } from './types.js';

/**
 * Groups addresses whose links clear the clustering threshold.
 *
 * Clustering is transitive by construction: if A links to B and B links to C, all three land in one
 * cluster even when A and C never touched. That is the correct read when the linking evidence is
 * about control, and it is why the threshold sits well above the reporting threshold. The weakest
 * edge holding a cluster together is reported alongside it so the transitive step stays visible
 * rather than hidden inside a single number.
 */
export function buildClusters(edges: LinkEdge[], allKeys: string[], threshold: number): Cluster[] {
  const uf = new UnionFind();
  for (const key of allKeys) uf.add(key);

  const strong = edges.filter((edge) => edge.score >= threshold);
  for (const edge of strong) uf.union(edge.a, edge.b);

  const groups = uf.groups(2);
  return groups.map((members, i) => {
    const inner = strong.filter((edge) => members.includes(edge.a) && members.includes(edge.b));
    const scores = inner.map((edge) => edge.score);
    const cohesion = scores.length > 0 ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : 0;
    const weakestLink = scores.length > 0 ? Math.min(...scores) : 0;
    const chains = [...new Set(members.map((key) => key.slice(0, key.indexOf(':'))))].sort();
    const signals = [...new Set(inner.flatMap((edge) => edge.signals))];

    return {
      id: `cluster-${i + 1}`,
      members: members.slice().sort(),
      cohesion,
      weakestLink,
      chains,
      rationale: describe(members.length, chains, signals, cohesion, weakestLink, inner.length),
    } satisfies Cluster;
  });
}

function describe(
  size: number,
  chains: string[],
  signals: string[],
  cohesion: number,
  weakest: number,
  edgeCount: number,
): string {
  const chainText = chains.length === 1 ? `on ${chains[0]}` : `across ${chains.join(', ')}`;
  const signalText = signals.slice(0, 3).join(', ');
  const transitive =
    edgeCount < (size * (size - 1)) / 2
      ? ` Not every pair links directly: the group is held together transitively, and its weakest connecting edge scores ${weakest}.`
      : '';
  return `${size} addresses ${chainText}, joined by ${signalText || 'multiple signals'} at an average edge score of ${cohesion}.${transitive}`;
}

/** Short label for a cluster, e.g. `0xd8dA…6045 +3`. */
export function clusterLabel(cluster: Cluster): string {
  const first = cluster.members[0] ?? '';
  const address = first.slice(first.indexOf(':') + 1);
  return cluster.members.length > 1
    ? `${shortAddress(address)} +${cluster.members.length - 1}`
    : shortAddress(address);
}
