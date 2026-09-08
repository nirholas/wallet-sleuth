import { ProviderError } from '../errors.js';
import { acquire, penalize, reward } from './scheduler.js';

export interface HttpOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  body?: unknown;
  /** Called once per completed attempt so callers can keep provider statistics. */
  onAttempt?: (info: { ms: number; ok: boolean; status: number }) => void;
  signal?: AbortSignal;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * JSON fetch with timeout, bounded exponential backoff and `Retry-After` support.
 *
 * Public endpoints rate limit aggressively, so a transient 429 must not fail an analysis; it is
 * retried with jitter and only surfaces as a `ProviderError` once the retry budget is spent.
 */
export async function fetchJson<T>(provider: string, url: string, options: HttpOptions = {}): Promise<T> {
  const { timeoutMs = 20_000, retries = 3, headers = {}, method = 'GET', body, onAttempt } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onOuterAbort, { once: true });
    const host = new URL(url).host;
    const release = await acquire(host);
    const started = Date.now();
    try {
      const response = await fetch(url, {
        method,
        headers: {
          accept: 'application/json',
          'user-agent': 'sleuth/1.0 (+https://github.com/nirholas/wallet-sleuth)',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const ms = Date.now() - started;
      onAttempt?.({ ms, ok: response.ok, status: response.status });
      if (response.status === 429 || response.status === 503) penalize(host);
      else if (response.ok) reward(host);

      if (!response.ok) {
        const retryable = RETRYABLE_STATUS.has(response.status);
        const text = await response.text().catch(() => '');
        const error = new ProviderError(
          provider,
          `HTTP ${response.status} from ${new URL(url).host}${text ? `: ${text.slice(0, 180)}` : ''}`,
          { retryable, status: response.status === 429 ? 429 : 502 },
        );
        if (!retryable || attempt === retries) throw error;
        lastError = error;
        const retryAfter = Number(response.headers.get('retry-after'));
        const backoff = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 400 * 2 ** attempt + Math.random() * 250;
        await sleep(Math.min(backoff, 8_000));
        continue;
      }

      return (await response.json()) as T;
    } catch (err) {
      const ms = Date.now() - started;
      if (!(err instanceof ProviderError)) onAttempt?.({ ms, ok: false, status: 0 });
      const aborted = (err as Error).name === 'AbortError';
      const error =
        err instanceof ProviderError
          ? err
          : new ProviderError(provider, aborted ? `timed out after ${timeoutMs}ms` : (err as Error).message);
      if (attempt === retries || (err instanceof ProviderError && !err.retryable)) throw error;
      lastError = error;
      await sleep(Math.min(400 * 2 ** attempt + Math.random() * 250, 8_000));
    } finally {
      clearTimeout(timer);
      release();
      options.signal?.removeEventListener('abort', onOuterAbort);
    }
  }

  throw lastError ?? new ProviderError(provider, 'request failed');
}

/** Builds a query string, dropping empty values so callers can pass optionals inline. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  return search.toString();
}
