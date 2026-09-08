/** Small numeric helpers shared by the signals. Kept dependency free and pure. */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Combine independent probabilities: `1 - Π(1 - p)`.
 * Used to merge evidence without letting any single signal exceed certainty.
 */
export function noisyOr(values: number[]): number {
  let miss = 1;
  for (const value of values) miss *= 1 - clamp01(value);
  return clamp01(1 - miss);
}

/** Jaccard similarity of two sets. Returns 0 when both are empty. */
export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const item of small) if (large.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function intersect<T>(a: Set<T>, b: Set<T>): T[] {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out: T[] = [];
  for (const item of small) if (large.has(item)) out.push(item);
  return out;
}

/** Cosine similarity of two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/**
 * Inverse document frequency for a shared counterparty.
 * A counterparty touched by every input carries no information; one touched by exactly two carries
 * the most. `total` is the number of input addresses, `shared` how many of them touched it.
 */
export function idf(total: number, shared: number): number {
  if (shared <= 1) return 0;
  if (total <= 2) return 1;
  const ratio = (shared - 1) / (total - 1);
  return clamp01(1 - ratio);
}

/** Decays to `half` at `halfLifeSeconds` of age. Recent evidence counts for more. */
export function recency(ts: number, now: number, halfLifeSeconds: number, floor = 0.35): number {
  if (!ts) return floor;
  const age = Math.max(0, now - ts);
  const decay = Math.pow(0.5, age / halfLifeSeconds);
  return clamp01(floor + (1 - floor) * decay);
}

/** Maps a raw count onto 0..1 with diminishing returns. `k` is the count that reaches ~0.63. */
export function saturate(count: number, k: number): number {
  if (count <= 0) return 0;
  return clamp01(1 - Math.exp(-count / k));
}

/** Relative difference between two amounts, 0 when identical. */
export function relativeDelta(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  if (scale === 0) return 0;
  return Math.abs(a - b) / scale;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0
    ? (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
    : (sorted[mid] as number);
}
