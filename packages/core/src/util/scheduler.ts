/**
 * Per-host request pacing.
 *
 * Keyless public endpoints are the whole point of Wallet Sleuth running with no configuration, and they
 * rate limit hard. Firing requests as fast as the event loop allows turns a working analysis into a
 * wall of 429s, so every outbound call passes through a per-host queue with a concurrency cap and a
 * minimum gap between requests. The gap is adaptive: a 429 widens it, sustained success narrows it
 * back, which lets one process share a public endpoint politely without hardcoding anyone's limits.
 */

interface HostState {
  active: number;
  lastStart: number;
  intervalMs: number;
  queue: (() => void)[];
  consecutiveOk: number;
  /** Exponentially weighted success rate, 0..1, seeded optimistically. */
  health: number;
}

const DEFAULT_CONCURRENCY = Number(process.env.SLEUTH_HOST_CONCURRENCY ?? 6);
const DEFAULT_INTERVAL = Number(process.env.SLEUTH_HOST_MIN_INTERVAL_MS ?? 60);
const MAX_INTERVAL = Number(process.env.SLEUTH_HOST_MAX_INTERVAL_MS ?? 2000);

const hosts = new Map<string, HostState>();

function stateFor(host: string): HostState {
  let state = hosts.get(host);
  if (!state) {
    state = { active: 0, lastStart: 0, intervalMs: DEFAULT_INTERVAL, queue: [], consecutiveOk: 0, health: 1 };
    hosts.set(host, state);
  }
  return state;
}

function pump(host: string): void {
  const state = stateFor(host);
  if (state.queue.length === 0 || state.active >= DEFAULT_CONCURRENCY) return;
  const wait = Math.max(0, state.lastStart + state.intervalMs - Date.now());
  if (wait > 0) {
    setTimeout(() => pump(host), wait);
    return;
  }
  const next = state.queue.shift();
  if (!next) return;
  state.active += 1;
  state.lastStart = Date.now();
  next();
}

/** Waits for a slot on `host`. The returned function must be called when the request settles. */
export function acquire(host: string): Promise<() => void> {
  return new Promise((resolve) => {
    const state = stateFor(host);
    state.queue.push(() => {
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        state.active -= 1;
        pump(host);
      });
    });
    pump(host);
  });
}

/** Widens the gap for a host that just rate limited us. */
export function penalize(host: string): void {
  const state = stateFor(host);
  state.consecutiveOk = 0;
  state.health = state.health * 0.6;
  state.intervalMs = Math.min(MAX_INTERVAL, Math.max(DEFAULT_INTERVAL * 2, state.intervalMs * 2.5));
}

/** Narrows the gap again after a run of clean responses. */
export function reward(host: string): void {
  const state = stateFor(host);
  state.health = state.health * 0.9 + 0.1;
  state.consecutiveOk += 1;
  if (state.consecutiveOk >= 20 && state.intervalMs > DEFAULT_INTERVAL) {
    state.intervalMs = Math.max(DEFAULT_INTERVAL, state.intervalMs * 0.75);
    state.consecutiveOk = 0;
  }
}

/**
 * How well a host has been behaving lately, 0..1.
 *
 * Providers with several interchangeable endpoints use this to send work where it is actually
 * being served, instead of round-robining into an endpoint that is rate limiting every call.
 */
export function health(host: string): number {
  return hosts.get(host)?.health ?? 1;
}

/** Orders candidate URLs healthiest first, keeping configured order as the tie-break. */
export function byHealth(urls: string[]): string[] {
  return urls
    .map((url, position) => ({ url, position, score: health(new URL(url).host) }))
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map((entry) => entry.url);
}

export function schedulerSnapshot(): { host: string; intervalMs: number; queued: number; active: number; health: number }[] {
  return [...hosts.entries()].map(([host, state]) => ({
    host,
    intervalMs: Math.round(state.intervalMs),
    queued: state.queue.length,
    active: state.active,
    health: Number(state.health.toFixed(2)),
  }));
}

/** Test hook: forget all pacing state. */
export function resetScheduler(): void {
  hosts.clear();
}
