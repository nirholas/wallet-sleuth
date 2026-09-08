/** Server configuration, resolved once at boot from the environment. */
export interface ServerConfig {
  host: string;
  port: number;
  logLevel: string;
  corsOrigins: string[];
  apiKeys: string[];
  rateLimitPerMinute: number;
  /** Separate, tighter budget for the one route that spends upstream requests. */
  analyzeRateLimitPerMinute: number;
  redisUrl?: string;
  cacheTtlSeconds: number;
  /** Directory holding the built web client, served at the root when it exists. */
  webRoot?: string;
  /** Hard ceiling on concurrent analyses, so one caller cannot exhaust the upstream budget. */
  maxConcurrentJobs: number;
  jobRetentionMs: number;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: Number(env.PORT ?? 8787),
    logLevel: env.LOG_LEVEL ?? 'info',
    corsOrigins: list(env.BRAID_CORS_ORIGINS),
    apiKeys: list(env.BRAID_API_KEYS),
    rateLimitPerMinute: Number(env.BRAID_RATE_LIMIT ?? 60),
    analyzeRateLimitPerMinute: Number(env.BRAID_ANALYZE_RATE_LIMIT ?? 10),
    redisUrl: env.REDIS_URL || undefined,
    cacheTtlSeconds: Number(env.BRAID_CACHE_TTL_SECONDS ?? 900),
    webRoot: env.BRAID_WEB_ROOT || undefined,
    maxConcurrentJobs: Number(env.BRAID_MAX_CONCURRENT_JOBS ?? 4),
    jobRetentionMs: Number(env.BRAID_JOB_RETENTION_MS ?? 60 * 60 * 1000),
  };
}
