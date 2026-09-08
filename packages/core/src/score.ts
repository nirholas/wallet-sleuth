import { clamp01, noisyOr } from './util/stats.js';
import type { Band, Evidence, LinkEdge } from './types.js';

/** Score thresholds for the confidence bands. Exported so clients label edges the same way. */
export const BANDS: { band: Band; min: number; label: string; meaning: string }[] = [
  {
    band: 'confirmed',
    min: 85,
    label: 'Confirmed',
    meaning: 'On-chain state or a signature ties the addresses together. Not an inference.',
  },
  {
    band: 'strong',
    min: 65,
    label: 'Strong',
    meaning: 'Several independent behaviours line up. Common control is the simplest explanation.',
  },
  {
    band: 'moderate',
    min: 40,
    label: 'Moderate',
    meaning: 'Real evidence with an innocent explanation available. Worth investigating further.',
  },
  { band: 'weak', min: 20, label: 'Weak', meaning: 'Circumstantial. Do not act on this alone.' },
  { band: 'none', min: 0, label: 'None', meaning: 'Nothing beyond what unrelated addresses share.' },
];

export function bandFor(score: number): Band {
  for (const entry of BANDS) if (score >= entry.min) return entry.band;
  return 'none';
}

/**
 * Repeats of one signal are worth less each time.
 *
 * Three shared counterparties are stronger than one, but not three times stronger: they are three
 * observations of the same underlying behaviour and share the same failure mode. Sorting by
 * confidence and halving each subsequent contribution keeps a single noisy signal from saturating a
 * score on its own.
 */
export function combineWithinSignal(confidences: number[], decay = 0.5): number {
  const sorted = confidences.slice().sort((a, b) => b - a);
  return noisyOr(sorted.map((value, i) => value * decay ** i));
}

export interface ScoredPair {
  a: string;
  b: string;
  score: number;
  band: Band;
  evidence: Evidence[];
  signals: string[];
  topSignal: string;
}

function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Turns evidence into edges.
 *
 * Independent signals combine with a noisy-OR, which is the right shape for "any one of these being
 * true implies a link": each additional signal closes part of the remaining doubt without any
 * single one being able to reach certainty by repetition.
 */
export function scoreEdges(evidence: Evidence[], minScore: number): LinkEdge[] {
  const grouped = new Map<string, Evidence[]>();
  for (const item of evidence) {
    const key = pairKey(item.a, item.b);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }

  const edges: LinkEdge[] = [];
  for (const [key, items] of grouped) {
    const [a, b] = key.split('|') as [string, string];
    const bySignal = new Map<string, Evidence[]>();
    for (const item of items) {
      const list = bySignal.get(item.signal) ?? [];
      list.push(item);
      bySignal.set(item.signal, list);
    }

    const perSignal = [...bySignal.entries()].map(([signal, list]) => ({
      signal,
      confidence: combineWithinSignal(list.map((item) => item.confidence)),
    }));
    const total = clamp01(noisyOr(perSignal.map((entry) => entry.confidence)));
    const score = Math.round(total * 100);
    if (score < minScore) continue;

    const ranked = items.slice().sort((x, y) => y.confidence - x.confidence);
    const top = perSignal.slice().sort((x, y) => y.confidence - x.confidence)[0];

    edges.push({
      a,
      b,
      score,
      band: bandFor(score),
      topSignal: top?.signal ?? (ranked[0]?.signal as string),
      signals: perSignal.sort((x, y) => y.confidence - x.confidence).map((entry) => entry.signal),
      crossChain: a.slice(0, a.indexOf(':')) !== b.slice(0, b.indexOf(':')),
      evidence: ranked,
    });
  }

  return edges.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a));
}
