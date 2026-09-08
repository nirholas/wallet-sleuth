import type {
  AnalysisReport,
  ChainDescriptor,
  ExpandResult,
  JobView,
  ParseResult,
  SignalDoc,
} from './types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (err) {
    throw new ApiError(
      `could not reach the Wallet Sleuth API (${(err as Error).message}). Is the server running?`,
      0,
    );
  }
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!response.ok) {
    throw new ApiError(
      (payload.message as string) ?? `request failed with ${response.status}`,
      response.status,
      payload.details,
    );
  }
  return payload as T;
}

export const api = {
  chains: () => request<{ chains: ChainDescriptor[] }>('/v1/chains'),
  signals: () => request<{ signals: SignalDoc[] }>('/v1/signals'),
  version: () =>
    request<{ version: string; maxAddresses: number; bands: { band: string; min: number; meaning: string }[] }>(
      '/v1/version',
    ),
  parse: (addresses: string, chains: string[]) =>
    request<ParseResult>('/v1/parse', {
      method: 'POST',
      body: JSON.stringify({ addresses, chains }),
    }),
  analyze: (body: unknown) =>
    request<JobView>('/v1/analyze', { method: 'POST', body: JSON.stringify(body) }),
  job: (id: string) => request<JobView>(`/v1/jobs/${id}`),
  expand: (chain: string, address: string, maxTransfers = 120) =>
    request<ExpandResult>('/v1/expand', {
      method: 'POST',
      body: JSON.stringify({ chain, address, maxTransfers }),
    }),
  report: (id: string) => request<AnalysisReport>(`/v1/jobs/${id}/report`),
  cancel: (id: string) => request<JobView>(`/v1/jobs/${id}`, { method: 'DELETE' }),
  exportUrl: (id: string, format: string) => `/v1/jobs/${id}/export?format=${encodeURIComponent(format)}`,
};

export interface JobStream {
  close(): void;
}

/**
 * Follows a job over server-sent events, falling back to polling.
 *
 * A proxy that buffers `text/event-stream` would otherwise leave the page frozen on "queued" for
 * the whole run, so the stream is watched for silence and the poller takes over if it never speaks.
 */
export function followJob(
  id: string,
  handlers: { onStatus: (job: JobView) => void; onReport: (report: AnalysisReport) => void; onError: (message: string) => void },
): JobStream {
  let closed = false;
  let source: EventSource | undefined;
  let pollTimer: number | undefined;
  let sawEvent = false;

  const startPolling = () => {
    if (closed || pollTimer !== undefined) return;
    const tick = async () => {
      if (closed) return;
      try {
        const job = await api.job(id);
        handlers.onStatus(job);
        if (job.status === 'done') {
          handlers.onReport(await api.report(id));
          stream.close();
          return;
        }
        if (job.status === 'failed' || job.status === 'cancelled') {
          handlers.onError(job.error?.message ?? `analysis ${job.status}`);
          stream.close();
          return;
        }
      } catch (err) {
        handlers.onError((err as Error).message);
        stream.close();
        return;
      }
      pollTimer = window.setTimeout(tick, 2000);
    };
    pollTimer = window.setTimeout(tick, 1500);
  };

  try {
    source = new EventSource(`/v1/jobs/${id}/events`);
    source.addEventListener('status', (event) => {
      sawEvent = true;
      const job = JSON.parse((event as MessageEvent).data) as JobView;
      handlers.onStatus(job);
      if (job.status === 'failed' || job.status === 'cancelled') {
        handlers.onError(job.error?.message ?? `analysis ${job.status}`);
        stream.close();
      }
    });
    source.addEventListener('report', (event) => {
      sawEvent = true;
      handlers.onReport(JSON.parse((event as MessageEvent).data) as AnalysisReport);
      stream.close();
    });
    source.addEventListener('error', () => {
      if (closed) return;
      source?.close();
      source = undefined;
      startPolling();
    });
  } catch {
    startPolling();
  }

  window.setTimeout(() => {
    if (!sawEvent && !closed) startPolling();
  }, 6000);

  const stream: JobStream = {
    close() {
      closed = true;
      source?.close();
      if (pollTimer !== undefined) window.clearTimeout(pollTimer);
    },
  };
  return stream;
}
