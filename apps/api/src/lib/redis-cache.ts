import { Redis } from 'ioredis';
import type { CacheStore } from '@wallet-sleuth/core';

/**
 * Redis-backed provider cache.
 *
 * Several Wallet Sleuth instances behind a load balancer would otherwise each pay full price for the same
 * upstream reads. Every failure path degrades to a miss rather than an error, because a cache that
 * can take the service down is worse than no cache.
 */
export class RedisCache implements CacheStore {
  private client: Redis;
  private healthy = true;

  constructor(url: string, private readonly prefix = 'sleuth:') {
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    this.client.on('error', () => {
      this.healthy = false;
    });
    this.client.on('ready', () => {
      this.healthy = true;
    });
  }

  async get(key: string): Promise<string | undefined> {
    if (!this.healthy) return undefined;
    try {
      return (await this.client.get(this.prefix + key)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.healthy) return;
    try {
      await this.client.set(this.prefix + key, value, 'EX', Math.max(1, Math.floor(ttlSeconds)));
    } catch {
      /* a cache write failure must never fail the request that triggered it */
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
