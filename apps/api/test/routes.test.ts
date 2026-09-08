import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { JobQueue } from '../src/lib/jobs.js';

let app: FastifyInstance;
let queue: JobQueue;

beforeAll(async () => {
  const built = await buildApp({ logLevel: 'silent', rateLimitPerMinute: 0, apiKeys: [] });
  app = built.app;
  queue = built.queue;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('metadata routes', () => {
  it('reports liveness', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('reports readiness with the configured providers', async () => {
    const response = await app.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.providers).toContain('blockscout');
    expect(body.providers).toContain('solana-rpc');
    expect(body.jobs).toBeDefined();
  });

  it('publishes the version, limits and bands', async () => {
    const body = (await app.inject({ method: 'GET', url: '/v1/version' })).json();
    expect(body.version).toBe('1.0.0');
    expect(body.maxAddresses).toBe(50);
    expect(body.bands.map((band: { band: string }) => band.band)).toContain('confirmed');
  });

  it('lists chains including both namespaces', async () => {
    const body = (await app.inject({ method: 'GET', url: '/v1/chains' })).json();
    const namespaces = new Set(body.chains.map((chain: { namespace: string }) => chain.namespace));
    expect(namespaces).toEqual(new Set(['evm', 'solana']));
  });

  it('documents every signal with a weight and a description', async () => {
    const body = (await app.inject({ method: 'GET', url: '/v1/signals' })).json();
    expect(body.signals.length).toBeGreaterThanOrEqual(14);
    for (const signal of body.signals) {
      expect(signal.description.length).toBeGreaterThan(80);
      expect(signal.weight).toBeGreaterThan(0);
      expect(signal.weight).toBeLessThanOrEqual(1);
    }
  });

  it('serves an OpenAPI document', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/api/json' });
    expect(response.statusCode).toBe(200);
    const spec = response.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths['/v1/analyze']).toBeDefined();
  });
});

describe('POST /v1/parse', () => {
  it('accepts valid addresses and explains the rejects', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parse',
      payload: {
        addresses: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM nope',
        chains: ['ethereum', 'solana'],
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accepted).toHaveLength(2);
    expect(body.rejected).toHaveLength(1);
    expect(body.distinctInputs).toBe(2);
  });

  it('accepts an array as well as a string', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/parse',
      payload: { addresses: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'], chains: ['ethereum'] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().accepted).toHaveLength(1);
  });
});

describe('POST /v1/analyze', () => {
  it('rejects an empty address list', async () => {
    const response = await app.inject({ method: 'POST', url: '/v1/analyze', payload: { addresses: [] } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('invalid_input');
  });

  it('rejects input containing no valid address', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/analyze',
      payload: { addresses: ['nope', 'still nope'] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().details).toHaveLength(2);
  });

  it('rejects more addresses than the engine allows', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `0x${String(i).padStart(40, '0')}`);
    const response = await app.inject({ method: 'POST', url: '/v1/analyze', payload: { addresses: many } });
    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('too many addresses');
  });

  it('rejects an unknown option', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/analyze',
      payload: { addresses: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'], options: { madeUp: 1 } },
    });
    expect(response.statusCode).toBe(400);
  });

  it('returns a job handle with follow-up links', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/analyze',
      payload: {
        addresses: ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'],
        chains: ['ethereum'],
        options: { budgetMs: 5000, enrichCounterparties: false },
      },
    });
    expect(response.statusCode).toBe(202);
    const job = response.json();
    expect(job.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(job.status).toBe('queued');
    expect(job.links.events).toBe(`/v1/jobs/${job.id}/events`);
    queue.cancel(job.id);
  });
});

describe('job routes', () => {
  it('404s an unknown job', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/jobs/00000000-0000-0000-0000-000000000000' });
    expect(response.statusCode).toBe(404);
  });

  it('409s a report that is not ready, and says what the job is doing', async () => {
    const job = queue.submit({
      addresses: ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'],
      chains: ['ethereum'],
      options: { budgetMs: 5000 },
    });
    const response = await app.inject({ method: 'GET', url: `/v1/jobs/${job.id}/report` });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('not_ready');
    expect(response.json().progress).toBeDefined();
    queue.cancel(job.id);
  });

  it('cancels a running job', async () => {
    const job = queue.submit({
      addresses: ['0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222'],
      chains: ['ethereum'],
      options: { budgetMs: 5000 },
    });
    const response = await app.inject({ method: 'DELETE', url: `/v1/jobs/${job.id}` });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('cancelled');
  });
});

describe('authentication', () => {
  it('requires a bearer key on /v1 when keys are configured, and never on health', async () => {
    const secured = await buildApp({ logLevel: 'silent', rateLimitPerMinute: 0, apiKeys: ['secret-key'] });
    await secured.app.ready();
    try {
      expect((await secured.app.inject({ method: 'GET', url: '/v1/chains' })).statusCode).toBe(401);
      expect((await secured.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
      const ok = await secured.app.inject({
        method: 'GET',
        url: '/v1/chains',
        headers: { authorization: 'Bearer secret-key' },
      });
      expect(ok.statusCode).toBe(200);
      const wrong = await secured.app.inject({
        method: 'GET',
        url: '/v1/chains',
        headers: { authorization: 'Bearer nope' },
      });
      expect(wrong.statusCode).toBe(401);
    } finally {
      await secured.app.close();
    }
  });
});

describe('option validation', () => {
  it('rejects an out of range option instead of silently clamping it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/analyze',
      payload: {
        addresses: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B'],
        options: { minScore: 500 },
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('fans a bare EVM address across the requested EVM chains', async () => {
    const body = (
      await app.inject({
        method: 'POST',
        url: '/v1/parse',
        payload: { addresses: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'], chains: ['ethereum', 'base'] },
      })
    ).json();
    expect(body.accepted.map((entry: { chain: string }) => entry.chain).sort()).toEqual(['base', 'ethereum']);
    expect(body.distinctInputs).toBe(1);
  });

  it('returns JSON, not the web client, for an unknown API path', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });
});

describe('health endpoints', () => {
  // Google's frontend answers the exact path /healthz with its own 404 on Cloud Run and never
  // forwards it, so a service that only registers that one path looks dead when probed there.
  const liveness = ['/healthz', '/health', '/livez', '/_health'];
  const readiness = ['/readyz', '/ready'];

  it.each(liveness)('answers liveness at %s', async (path) => {
    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it.each(readiness)('answers readiness at %s', async (path) => {
    const response = await app.inject({ method: 'GET', url: path });
    expect(response.statusCode).toBe(200);
    expect(response.json().providers.length).toBeGreaterThan(0);
  });

  it('answers a probe that arrives with a trailing slash', async () => {
    const response = await app.inject({ method: 'GET', url: '/healthz/' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
  });

  it('does not let the web client fallback answer a health path with 200 HTML', async () => {
    // A catch-all that returns index.html for every unknown path turns a health check into
    // something that can never fail, which is worse than having none.
    for (const path of [...liveness, ...readiness]) {
      const response = await app.inject({ method: 'GET', url: path });
      expect(response.headers['content-type']).toMatch(/application\/json/);
    }
  });
});
