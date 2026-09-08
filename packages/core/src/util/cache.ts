import { LRUCache } from 'lru-cache';

/**
 * Cache contract used by the providers. The default is an in-process LRU; the API server swaps in
 * a Redis-backed store when `REDIS_URL` is set, so several instances share one upstream budget.
 */
export interface CacheStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

export class MemoryCache implements CacheStore {
  private lru: LRUCache<string, string>;

  constructor(maxEntries = 5000) {
    this.lru = new LRUCache<string, string>({ max: maxEntries, ttl: 15 * 60 * 1000 });
  }

  async get(key: string): Promise<string | undefined> {
    return this.lru.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.lru.set(key, value, { ttl: Math.max(1, ttlSeconds) * 1000 });
  }
}

/** A cache that stores nothing. Useful for tests and for `--no-cache` runs. */
export class NullCache implements CacheStore {
  async get(): Promise<string | undefined> {
    return undefined;
  }

  async set(): Promise<void> {
    /* intentionally does not store */
  }
}

/** Wraps a fetcher so identical calls inside the TTL cost one upstream request. */
export async function cached<T>(
  store: CacheStore,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<T> {
  const hit = await store.get(key);
  if (hit !== undefined) {
    try {
      return JSON.parse(hit) as T;
    } catch {
      /* fall through to a fresh load when a cached entry is corrupt */
    }
  }
  const value = await load();
  await store.set(key, JSON.stringify(value), ttlSeconds);
  return value;
}
