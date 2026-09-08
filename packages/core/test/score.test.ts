import { describe, expect, it } from 'vitest';
import { bandFor, combineWithinSignal, scoreEdges } from '../src/score.js';
import { buildClusters } from '../src/cluster.js';
import { UnionFind } from '../src/util/unionfind.js';
import type { Evidence } from '../src/types.js';

function evidence(partial: Partial<Evidence> & { signal: string; confidence: number }): Evidence {
  return {
    category: 'flow',
    a: 'ethereum:0xa',
    b: 'ethereum:0xb',
    strength: partial.confidence,
    weight: 1,
    title: partial.signal,
    detail: '',
    observations: [],
    references: [],
    ...partial,
  } as Evidence;
}

describe('combineWithinSignal', () => {
  it('lets repeats add something without letting them saturate the signal', () => {
    const one = combineWithinSignal([0.5]);
    const three = combineWithinSignal([0.5, 0.5, 0.5]);
    expect(three).toBeGreaterThan(one);
    // Three observations of the same behaviour must stay well short of certainty.
    expect(three).toBeLessThan(0.75);
  });

  it('is dominated by the strongest observation regardless of input order', () => {
    expect(combineWithinSignal([0.1, 0.9])).toBeCloseTo(combineWithinSignal([0.9, 0.1]), 9);
    expect(combineWithinSignal([0.9, 0.1])).toBeGreaterThan(0.9);
  });
});

describe('scoreEdges', () => {
  it('drops pairs below the reporting threshold', () => {
    const edges = scoreEdges([evidence({ signal: 'temporal-profile', confidence: 0.05 })], 15);
    expect(edges).toHaveLength(0);
  });

  it('scores independent signals higher than repeats of one signal', () => {
    const repeated = scoreEdges(
      [
        evidence({ signal: 'common-funder', confidence: 0.5 }),
        evidence({ signal: 'common-funder', confidence: 0.5 }),
      ],
      0,
    );
    const independent = scoreEdges(
      [
        evidence({ signal: 'common-funder', confidence: 0.5 }),
        evidence({ signal: 'direct-transfer', confidence: 0.5 }),
      ],
      0,
    );
    expect(independent[0]!.score).toBeGreaterThan(repeated[0]!.score);
    expect(independent[0]!.score).toBe(75);
  });

  it('normalises pair order so a<->b and b<->a are one edge', () => {
    const edges = scoreEdges(
      [
        evidence({ signal: 'direct-transfer', confidence: 0.6, a: 'ethereum:0xb', b: 'ethereum:0xa' }),
        evidence({ signal: 'common-funder', confidence: 0.4, a: 'ethereum:0xa', b: 'ethereum:0xb' }),
      ],
      0,
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]!.signals).toContain('direct-transfer');
    expect(edges[0]!.signals).toContain('common-funder');
  });

  it('ranks the strongest signal first and sorts edges by score', () => {
    const edges = scoreEdges(
      [
        evidence({ signal: 'temporal-profile', confidence: 0.1 }),
        evidence({ signal: 'solana-account-control', confidence: 0.95 }),
        evidence({ signal: 'direct-transfer', confidence: 0.3, a: 'ethereum:0xc', b: 'ethereum:0xd' }),
      ],
      0,
    );
    expect(edges[0]!.topSignal).toBe('solana-account-control');
    expect(edges[0]!.score).toBeGreaterThan(edges[1]!.score);
  });

  it('flags cross chain pairs', () => {
    const edges = scoreEdges(
      [evidence({ signal: 'cross-chain-stable', confidence: 0.5, a: 'ethereum:0xa', b: 'solana:abc' })],
      0,
    );
    expect(edges[0]!.crossChain).toBe(true);
  });
});

describe('bands', () => {
  it('maps scores onto the documented bands', () => {
    expect(bandFor(100)).toBe('confirmed');
    expect(bandFor(85)).toBe('confirmed');
    expect(bandFor(84)).toBe('strong');
    expect(bandFor(65)).toBe('strong');
    expect(bandFor(64)).toBe('moderate');
    expect(bandFor(40)).toBe('moderate');
    expect(bandFor(39)).toBe('weak');
    expect(bandFor(20)).toBe('weak');
    expect(bandFor(19)).toBe('none');
    expect(bandFor(0)).toBe('none');
  });
});

describe('UnionFind', () => {
  it('groups transitively and reports only groups of two or more', () => {
    const uf = new UnionFind();
    uf.union('a', 'b');
    uf.union('b', 'c');
    uf.add('lonely');
    expect(uf.connected('a', 'c')).toBe(true);
    expect(uf.connected('a', 'lonely')).toBe(false);
    const groups = uf.groups(2);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('buildClusters', () => {
  const edge = (a: string, b: string, score: number) => ({
    a,
    b,
    score,
    band: bandFor(score),
    topSignal: 'direct-transfer',
    signals: ['direct-transfer'],
    crossChain: false,
    evidence: [],
  });

  it('only merges on edges at or above the threshold', () => {
    const clusters = buildClusters(
      [edge('ethereum:0xa', 'ethereum:0xb', 70), edge('ethereum:0xb', 'ethereum:0xc', 40)],
      ['ethereum:0xa', 'ethereum:0xb', 'ethereum:0xc'],
      55,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.members).toEqual(['ethereum:0xa', 'ethereum:0xb']);
  });

  it('merges transitively and reports the weakest link that holds the cluster together', () => {
    const clusters = buildClusters(
      [edge('ethereum:0xa', 'ethereum:0xb', 90), edge('ethereum:0xb', 'ethereum:0xc', 56)],
      ['ethereum:0xa', 'ethereum:0xb', 'ethereum:0xc'],
      55,
    );
    expect(clusters[0]!.members).toHaveLength(3);
    expect(clusters[0]!.weakestLink).toBe(56);
    expect(clusters[0]!.cohesion).toBe(73);
    // A transitive merge must be visible in the text, not hidden behind the average.
    expect(clusters[0]!.rationale).toMatch(/transitively/);
  });

  it('produces nothing when no edge clears the threshold', () => {
    const clusters = buildClusters(
      [edge('ethereum:0xa', 'ethereum:0xb', 30)],
      ['ethereum:0xa', 'ethereum:0xb'],
      55,
    );
    expect(clusters).toEqual([]);
  });

  it('records every chain a cluster spans', () => {
    const clusters = buildClusters(
      [{ ...edge('ethereum:0xa', 'solana:abc', 88), crossChain: true }],
      ['ethereum:0xa', 'solana:abc'],
      55,
    );
    expect(clusters[0]!.chains).toEqual(['ethereum', 'solana']);
  });
});
