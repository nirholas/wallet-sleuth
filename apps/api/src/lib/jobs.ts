import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { analyze, type AnalysisReport, type AnalysisRequest, type CacheStore, type ProgressEvent } from '@wallet-sleuth/core';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  status: JobStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  request: AnalysisRequest;
  progress: ProgressEvent;
  report?: AnalysisReport;
  error?: { code: string; message: string; details?: unknown };
}

export interface JobView {
  id: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  progress: ProgressEvent;
  addresses: number;
  error?: { code: string; message: string; details?: unknown };
  links: { self: string; events: string; report: string };
}

/**
 * In-process analysis queue.
 *
 * Analyses take tens of seconds against keyless endpoints, which is far too long to hold an HTTP
 * request open through a typical proxy. Callers submit a job, watch it over server-sent events and
 * collect the report when it lands. Concurrency is capped so a burst of submissions queues instead
 * of stampeding the upstream providers and getting everyone rate limited.
 */
export class JobQueue extends EventEmitter {
  private jobs = new Map<string, Job>();
  private waiting: string[] = [];
  private running = 0;
  private controllers = new Map<string, AbortController>();
  private sweeper: NodeJS.Timeout;

  constructor(
    private readonly cache: CacheStore,
    private readonly maxConcurrent: number,
    private readonly retentionMs: number,
    private readonly cacheTtlSeconds: number,
  ) {
    super();
    this.setMaxListeners(0);
    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  submit(request: AnalysisRequest): Job {
    const job: Job = {
      id: randomUUID(),
      status: 'queued',
      createdAt: Date.now(),
      request,
      progress: { phase: 'parse', progress: 0, message: 'queued' },
    };
    this.jobs.set(job.id, job);
    this.waiting.push(job.id);
    queueMicrotask(() => this.pump());
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    // A job that already reached a terminal state, cancellation included, cannot be cancelled again.
    if (!job || job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return false;
    this.controllers.get(id)?.abort();
    this.waiting = this.waiting.filter((waitingId) => waitingId !== id);
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    this.emit(`update:${id}`, job);
    return true;
  }

  /** Resolves when the job leaves a running state, or when the timeout expires. */
  async wait(id: string, timeoutMs: number): Promise<Job | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') return job;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.off(`update:${id}`, onUpdate);
        resolve(this.jobs.get(id));
      }, timeoutMs);
      const onUpdate = (updated: Job) => {
        if (updated.status === 'done' || updated.status === 'failed' || updated.status === 'cancelled') {
          clearTimeout(timer);
          this.off(`update:${id}`, onUpdate);
          resolve(updated);
        }
      };
      this.on(`update:${id}`, onUpdate);
    });
  }

  stats(): { queued: number; running: number; total: number } {
    return { queued: this.waiting.length, running: this.running, total: this.jobs.size };
  }

  private pump(): void {
    while (this.running < this.maxConcurrent && this.waiting.length > 0) {
      const id = this.waiting.shift() as string;
      const job = this.jobs.get(id);
      if (!job || job.status !== 'queued') continue;
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    this.running += 1;
    job.status = 'running';
    job.startedAt = Date.now();
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.emit(`update:${job.id}`, job);

    try {
      const report = await analyze(job.request, {
        cache: this.cache,
        cacheTtlSeconds: this.cacheTtlSeconds,
        signal: controller.signal,
        onProgress: (progress) => {
          if (job.status !== 'running') return;
          job.progress = progress;
          this.emit(`update:${job.id}`, job);
        },
      });
      if ((job.status as JobStatus) === 'cancelled') return;
      // The report is addressed by its job id from here on, so that a client holding a report can
      // build its own export and status URLs without carrying two identifiers around.
      job.report = { ...report, id: job.id };
      job.status = 'done';
      job.progress = { phase: 'done', progress: 1, message: 'analysis complete' };
    } catch (err) {
      const error = err as Error & { code?: string; details?: unknown };
      job.status = 'failed';
      job.error = {
        code: error.code ?? 'analysis_failed',
        message: error.message,
        details: error.details,
      };
      job.progress = { phase: 'done', progress: 1, message: 'analysis failed' };
    } finally {
      job.finishedAt = Date.now();
      this.running -= 1;
      this.controllers.delete(job.id);
      this.emit(`update:${job.id}`, job);
      this.pump();
    }
  }

  private sweep(): void {
    const cutoff = Date.now() - this.retentionMs;
    for (const [id, job] of this.jobs) {
      if ((job.finishedAt ?? job.createdAt) < cutoff) this.jobs.delete(id);
    }
  }

  async close(): Promise<void> {
    clearInterval(this.sweeper);
    for (const controller of this.controllers.values()) controller.abort();
  }
}

export function toView(job: Job): JobView {
  return {
    id: job.id,
    status: job.status,
    createdAt: new Date(job.createdAt).toISOString(),
    startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : undefined,
    progress: job.progress,
    addresses: job.request.addresses.length,
    error: job.error,
    links: {
      self: `/v1/jobs/${job.id}`,
      events: `/v1/jobs/${job.id}/events`,
      report: `/v1/jobs/${job.id}/report`,
    },
  };
}
