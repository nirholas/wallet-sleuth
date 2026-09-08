import {
  accountsToCsv,
  ALL_SIGNALS,
  BANDS,
  DEFAULT_OPTIONS,
  edgesToCsv,
  expand,
  LICENSE,
  listChains,
  MAX_ADDRESSES,
  parseAddressList,
  SOURCE_URL,
  toGraphml,
  VERSION,
} from '@wallet-sleuth/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { toView, type Job, type JobQueue } from '../lib/jobs.js';

const optionsSchema = z
  .object({
    maxTransfersPerAddress: z.number().int().min(25).max(5000).optional(),
    lookbackDays: z.number().int().min(0).max(3650).optional(),
    minScore: z.number().int().min(0).max(100).optional(),
    clusterThreshold: z.number().int().min(1).max(100).optional(),
    signals: z.array(z.string()).optional(),
    hubShareThreshold: z.number().int().min(2).max(1000).optional(),
    enrichCounterparties: z.boolean().optional(),
    budgetMs: z.number().int().min(5000).max(900_000).optional(),
  })
  .strict();

const analyzeSchema = z
  .object({
    addresses: z.union([z.string(), z.array(z.string())]),
    chains: z.array(z.string()).optional(),
    options: optionsSchema.optional(),
    /** Block until the analysis finishes instead of returning a job handle. */
    wait: z.boolean().optional(),
  })
  .strict();

function normalizeAddresses(input: string | string[]): string[] {
  return (Array.isArray(input) ? input : input.split(/[\s,;]+/)).map((v) => v.trim()).filter(Boolean);
}

function requireJob(queue: JobQueue, id: string, reply: FastifyReply): Job | undefined {
  const job = queue.get(id);
  if (!job) {
    void reply.code(404).send({ error: 'not_found', message: `no job with id ${id}` });
    return undefined;
  }
  return job;
}

function requireReport(job: Job, reply: FastifyReply) {
  if (job.status !== 'done' || !job.report) {
    void reply.code(409).send({
      error: 'not_ready',
      message: `job is ${job.status}`,
      status: job.status,
      progress: job.progress,
    });
    return undefined;
  }
  return job.report;
}

export function registerAnalysisRoutes(app: FastifyInstance, queue: JobQueue, analyzeLimit = 0): void {
  app.get(
    '/v1/version',
    {
      schema: {
        summary: 'Engine version and defaults',
        tags: ['meta'],
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    async () => ({
      version: VERSION,
      license: LICENSE,
      source: SOURCE_URL,
      maxAddresses: MAX_ADDRESSES,
      defaults: DEFAULT_OPTIONS,
      bands: BANDS,
    }),
  );

  app.get(
    '/v1/chains',
    { schema: { summary: 'Chains Wallet Sleuth can read', tags: ['meta'] } },
    async () => ({ chains: listChains() }),
  );

  app.get(
    '/v1/signals',
    { schema: { summary: 'Signals, their weights and what each one proves', tags: ['meta'] } },
    async () => ({
      signals: ALL_SIGNALS.map((signal) => ({
        id: signal.id,
        title: signal.title,
        category: signal.category,
        weight: signal.weight,
        namespaces: signal.namespaces ?? ['evm', 'solana'],
        description: signal.description,
      })),
    }),
  );

  app.post(
    '/v1/parse',
    {
      schema: {
        summary: 'Validate an address list without running an analysis',
        tags: ['analysis'],
        body: {
          type: 'object',
          required: ['addresses'],
          properties: {
            addresses: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
            chains: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = z
        .object({
          addresses: z.union([z.string(), z.array(z.string())]),
          chains: z.array(z.string()).optional(),
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'invalid_input', message: parsed.error.message });
      }
      const addresses = normalizeAddresses(parsed.data.addresses);
      const result = parseAddressList(addresses, parsed.data.chains);
      return {
        accepted: result.refs.map((ref) => ({
          key: ref.key,
          chain: ref.chain,
          address: ref.address,
          namespace: ref.namespace,
          explicit: ref.explicit,
        })),
        rejected: result.rejected,
        distinctInputs: new Set(result.refs.map((ref) => ref.input)).size,
      };
    },
  );

  app.post(
    '/v1/analyze',
    {
      // Starting an analysis is the only route that spends upstream requests, so it carries its own
      // tighter budget on top of the general limiter.
      ...(analyzeLimit > 0
        ? { config: { rateLimit: { max: analyzeLimit, timeWindow: '1 minute' } } }
        : {}),
      schema: {
        summary: 'Start a linkage analysis',
        description:
          'Submits an address list and returns a job handle. Poll `/v1/jobs/{id}` or stream `/v1/jobs/{id}/events`. Pass `wait: true` to block until the analysis finishes, which is convenient from a script but can hold the connection open for a minute or more.',
        tags: ['analysis'],
        body: {
          type: 'object',
          required: ['addresses'],
          properties: {
            addresses: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] },
            chains: { type: 'array', items: { type: 'string' } },
            wait: { type: 'boolean' },
            options: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = analyzeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_input',
          message: 'request body failed validation',
          details: parsed.error.issues,
        });
      }

      const addresses = normalizeAddresses(parsed.data.addresses);
      if (addresses.length === 0) {
        return reply.code(400).send({ error: 'invalid_input', message: 'no addresses supplied' });
      }
      if (addresses.length > MAX_ADDRESSES) {
        return reply.code(400).send({
          error: 'invalid_input',
          message: `too many addresses: ${addresses.length} supplied, ${MAX_ADDRESSES} is the maximum`,
        });
      }

      const preflight = parseAddressList(addresses, parsed.data.chains);
      if (preflight.refs.length === 0) {
        return reply.code(400).send({
          error: 'invalid_input',
          message: 'none of the supplied values are valid EVM or Solana addresses',
          details: preflight.rejected,
        });
      }

      const job = queue.submit({
        addresses,
        chains: parsed.data.chains,
        options: parsed.data.options,
      });

      if (parsed.data.wait) {
        const finished = await queue.wait(job.id, 15 * 60 * 1000);
        if (finished?.status === 'done' && finished.report) return finished.report;
        if (finished?.status === 'failed') {
          return reply.code(502).send({ error: finished.error?.code ?? 'analysis_failed', ...finished.error });
        }
        return reply.code(202).send(toView(finished ?? job));
      }

      return reply.code(202).send(toView(job));
    },
  );

  app.post(
    '/v1/expand',
    {
      ...(analyzeLimit > 0
        ? { config: { rateLimit: { max: analyzeLimit * 4, timeWindow: '1 minute' } } }
        : {}),
      schema: {
        summary: 'Read one address\'s value neighbourhood',
        description:
          'Pulls the flow graph around a single address. Used to expand a counterparty in the graph without starting a new analysis. Deliberately shallower and faster than /v1/analyze: it reads value movement, not linkage signals.',
        tags: ['analysis'],
        body: {
          type: 'object',
          required: ['chain', 'address'],
          properties: {
            chain: { type: 'string' },
            address: { type: 'string' },
            maxTransfers: { type: 'integer', minimum: 20, maximum: 500 },
            budgetMs: { type: 'integer', minimum: 5000, maximum: 120000 },
          },
        },
      },
    },
    async (request, reply) => {
      const parsed = z
        .object({
          chain: z.string().min(1),
          address: z.string().min(1),
          maxTransfers: z.number().int().min(20).max(500).optional(),
          budgetMs: z.number().int().min(5000).max(120_000).optional(),
        })
        .strict()
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'invalid_input',
          message: 'request body failed validation',
          details: parsed.error.issues,
        });
      }
      // A client that navigates away should not leave the expansion burning upstream requests.
      const controller = new AbortController();
      request.raw.on('close', () => controller.abort());
      return expand(parsed.data, { cache: queue.cache, signal: controller.signal });
    },
  );

  app.get('/v1/jobs/:id', { schema: { summary: 'Job status', tags: ['analysis'] } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = requireJob(queue, id, reply);
    return job ? toView(job) : undefined;
  });

  app.delete('/v1/jobs/:id', { schema: { summary: 'Cancel a job', tags: ['analysis'] } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = requireJob(queue, id, reply);
    if (!job) return undefined;
    const cancelled = queue.cancel(id);
    return reply.code(cancelled ? 200 : 409).send(toView(queue.get(id) as Job));
  });

  app.get(
    '/v1/jobs/:id/report',
    { schema: { summary: 'Completed analysis report', tags: ['analysis'] } },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const job = requireJob(queue, id, reply);
      if (!job) return undefined;
      return requireReport(job, reply);
    },
  );

  app.get(
    '/v1/jobs/:id/export',
    {
      schema: {
        summary: 'Export a report as CSV or GraphML',
        tags: ['analysis'],
        querystring: {
          type: 'object',
          properties: { format: { type: 'string', enum: ['edges.csv', 'accounts.csv', 'graphml', 'json'] } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { format = 'edges.csv' } = request.query as { format?: string };
      const job = requireJob(queue, id, reply);
      if (!job) return undefined;
      const report = requireReport(job, reply);
      if (!report) return undefined;

      switch (format) {
        case 'accounts.csv':
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="sleuth-${id}-accounts.csv"`)
            .send(accountsToCsv(report));
        case 'graphml':
          return reply
            .header('content-type', 'application/xml; charset=utf-8')
            .header('content-disposition', `attachment; filename="sleuth-${id}.graphml"`)
            .send(toGraphml(report));
        case 'json':
          return reply
            .header('content-disposition', `attachment; filename="sleuth-${id}.json"`)
            .send(report);
        default:
          return reply
            .header('content-type', 'text/csv; charset=utf-8')
            .header('content-disposition', `attachment; filename="sleuth-${id}-edges.csv"`)
            .send(edgesToCsv(report));
      }
    },
  );

  /**
   * Progress stream.
   *
   * An analysis runs for tens of seconds against public endpoints, and a progress bar that moves is
   * the difference between a tool people trust and one they assume has hung. The stream closes
   * itself as soon as the job reaches a terminal state.
   */
  app.get('/v1/jobs/:id/events', { schema: { hide: true } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const job = queue.get(id);
    if (!job) return reply.code(404).send({ error: 'not_found', message: `no job with id ${id}` });

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('status', toView(job));
    const onUpdate = (updated: Job) => {
      send('status', toView(updated));
      if (updated.status === 'done' && updated.report) send('report', updated.report);
      if (updated.status === 'done' || updated.status === 'failed' || updated.status === 'cancelled') {
        queue.off(`update:${id}`, onUpdate);
        clearInterval(heartbeat);
        reply.raw.end();
      }
    };

    if (job.status === 'done' && job.report) {
      send('report', job.report);
      reply.raw.end();
      return reply;
    }
    if (job.status === 'failed' || job.status === 'cancelled') {
      reply.raw.end();
      return reply;
    }

    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 15_000);
    queue.on(`update:${id}`, onUpdate);
    request.raw.on('close', () => {
      queue.off(`update:${id}`, onUpdate);
      clearInterval(heartbeat);
    });
    return reply;
  });
}
