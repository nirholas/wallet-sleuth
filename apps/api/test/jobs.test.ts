import { describe, expect, it, vi } from 'vitest';
import type { AnalysisReport } from '@braid/core';

const analyzeMock = vi.hoisted(() => vi.fn());

vi.mock('@braid/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@braid/core')>();
  return { ...actual, analyze: analyzeMock };
});

const { JobQueue, toView } = await import('../src/lib/jobs.js');
const { NullCache } = await import('@braid/core');

function report(id: string): AnalysisReport {
  return {
    id,
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    durationMs: 1,
    options: {} as AnalysisReport['options'],
    accounts: [],
    edges: [],
    clusters: [],
    hubs: [],
    warnings: [],
    providers: [],
    rejected: [],
    summary: { addresses: 0, linked: 0, clusters: 0, strongestScore: 0, transfersAnalyzed: 0, chains: [] },
  };
}

function queue(maxConcurrent = 2) {
  return new JobQueue(new NullCache(), maxConcurrent, 60_000, 60);
}

describe('job queue', () => {
  it('addresses the finished report by its job id, so a client can build its own export URLs', async () => {
    analyzeMock.mockResolvedValueOnce(report('a-completely-different-id'));
    const jobs = queue();
    const job = jobs.submit({ addresses: ['0xa', '0xb'] });
    const finished = await jobs.wait(job.id, 5000);
    expect(finished?.status).toBe('done');
    expect(finished?.report?.id).toBe(job.id);
    await jobs.close();
  });

  it('records a failure instead of throwing, and keeps the reason', async () => {
    analyzeMock.mockRejectedValueOnce(Object.assign(new Error('upstream is down'), { code: 'provider_error' }));
    const jobs = queue();
    const job = jobs.submit({ addresses: ['0xa', '0xb'] });
    const finished = await jobs.wait(job.id, 5000);
    expect(finished?.status).toBe('failed');
    expect(finished?.error).toMatchObject({ code: 'provider_error', message: 'upstream is down' });
    await jobs.close();
  });

  it('queues work beyond the concurrency limit rather than stampeding the providers', async () => {
    let running = 0;
    let peak = 0;
    analyzeMock.mockImplementation(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 25));
      running -= 1;
      return report('x');
    });
    const jobs = queue(2);
    const submitted = Array.from({ length: 6 }, () => jobs.submit({ addresses: ['0xa', '0xb'] }));
    await Promise.all(submitted.map((job) => jobs.wait(job.id, 5000)));
    expect(peak).toBeLessThanOrEqual(2);
    await jobs.close();
  });

  it('emits a terminal update for a cancelled job and stops reporting it as running', async () => {
    analyzeMock.mockImplementation(() => new Promise(() => undefined));
    const jobs = queue();
    const job = jobs.submit({ addresses: ['0xa', '0xb'] });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(jobs.cancel(job.id)).toBe(true);
    expect(jobs.get(job.id)?.status).toBe('cancelled');
    expect(jobs.cancel(job.id)).toBe(false);
    await jobs.close();
  });

  it('exposes follow-up links on the job view', () => {
    const jobs = queue();
    const job = jobs.submit({ addresses: ['0xa', '0xb'] });
    const view = toView(job);
    expect(view.links).toEqual({
      self: `/v1/jobs/${job.id}`,
      events: `/v1/jobs/${job.id}/events`,
      report: `/v1/jobs/${job.id}/report`,
    });
    jobs.cancel(job.id);
    void jobs.close();
  });
});
