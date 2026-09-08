import { describe, expect, it } from 'vitest';
import { clamp01, cosine, idf, jaccard, noisyOr, recency, relativeDelta, saturate } from '../src/util/stats.js';
import { fromBaseUnits } from '../src/util/units.js';

describe('noisyOr', () => {
  it('returns 0 for no evidence and never reaches 1 from finite evidence', () => {
    expect(noisyOr([])).toBe(0);
    expect(noisyOr([0.9, 0.9, 0.9])).toBeLessThan(1);
  });

  it('combines independent evidence so each addition closes part of the remaining doubt', () => {
    expect(noisyOr([0.5, 0.5])).toBeCloseTo(0.75, 6);
    expect(noisyOr([0.5, 0.5, 0.5])).toBeCloseTo(0.875, 6);
  });

  it('is monotonic: more evidence never lowers the result', () => {
    const base = noisyOr([0.4, 0.2]);
    expect(noisyOr([0.4, 0.2, 0.1])).toBeGreaterThanOrEqual(base);
  });

  it('passes certainty straight through', () => {
    expect(noisyOr([1, 0.3])).toBe(1);
  });
});

describe('jaccard', () => {
  it('is 0 when either side is empty, so a wallet with no counterparties never matches', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
  });

  it('measures overlap relative to the union, not to the smaller set', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a', 'b']), new Set(['b', 'c']))).toBeCloseTo(1 / 3, 6);
    // One shared counterparty out of a hundred is not similarity.
    const wide = new Set(Array.from({ length: 100 }, (_, i) => `x${i}`));
    expect(jaccard(new Set(['x0']), wide)).toBeCloseTo(0.01, 6);
  });
});

describe('idf', () => {
  it('is 0 when only one input touched the counterparty', () => {
    expect(idf(10, 1)).toBe(0);
  });

  it('gives the most weight to a counterparty exactly two inputs share', () => {
    expect(idf(10, 2)).toBeGreaterThan(idf(10, 5));
    expect(idf(10, 10)).toBe(0);
  });
});

describe('recency', () => {
  const now = 1_700_000_000;

  it('is highest for something that just happened', () => {
    expect(recency(now, now, 86_400)).toBeCloseTo(1, 6);
  });

  it('decays to the midpoint after one half life and never below the floor', () => {
    expect(recency(now - 86_400, now, 86_400, 0)).toBeCloseTo(0.5, 6);
    expect(recency(now - 86_400 * 10_000, now, 86_400, 0.35)).toBeCloseTo(0.35, 6);
  });

  it('treats a missing timestamp as the floor rather than as fresh', () => {
    expect(recency(0, now, 86_400, 0.35)).toBe(0.35);
  });
});

describe('saturate', () => {
  it('has diminishing returns and stays inside 0..1', () => {
    expect(saturate(0, 3)).toBe(0);
    expect(saturate(3, 3)).toBeCloseTo(0.6321, 3);
    expect(saturate(1000, 3)).toBeLessThanOrEqual(1);
    expect(saturate(10, 3) - saturate(9, 3)).toBeLessThan(saturate(2, 3) - saturate(1, 3));
  });
});

describe('relativeDelta', () => {
  it('is 0 for identical amounts and scale free', () => {
    expect(relativeDelta(100, 100)).toBe(0);
    expect(relativeDelta(0, 0)).toBe(0);
    expect(relativeDelta(100, 101)).toBeCloseTo(relativeDelta(1000, 1010), 6);
  });
});

describe('cosine', () => {
  it('is 1 for proportional vectors and 0 when either is empty', () => {
    expect(cosine([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 6);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe('clamp01', () => {
  it('clamps and rejects non-finite input', () => {
    expect(clamp01(-3)).toBe(0);
    expect(clamp01(3)).toBe(1);
    expect(clamp01(Number.NaN)).toBe(0);
  });
});

describe('fromBaseUnits', () => {
  it('converts without losing the leading digits of a large balance', () => {
    expect(fromBaseUnits('1000000000000000000', 18)).toBe(1);
    expect(fromBaseUnits('1', 18)).toBeCloseTo(1e-18, 24);
    expect(fromBaseUnits('123456789', 6)).toBeCloseTo(123.456789, 9);
    expect(fromBaseUnits('0', 18)).toBe(0);
    expect(fromBaseUnits('', 18)).toBe(0);
    expect(fromBaseUnits('42', 0)).toBe(42);
  });
});
