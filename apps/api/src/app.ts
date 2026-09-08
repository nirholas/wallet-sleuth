import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyInstance } from 'fastify';
import { SleuthError, buildProviders, MemoryCache, schedulerSnapshot, VERSION, type CacheStore } from '@wallet-sleuth/core';
import { loadConfig, type ServerConfig } from './config.js';
import { JobQueue } from './lib/jobs.js';
import { RedisCache } from './lib/redis-cache.js';
import { registerAnalysisRoutes } from './routes/analysis.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Locates the built web client, so one process serves both the API and the UI. */
function findWebRoot(config: ServerConfig): string | undefined {
  const candidates = [
    config.webRoot,
    resolve(here, '../../web/dist'),
    resolve(here, '../../../apps/web/dist'),
    resolve(process.cwd(), 'apps/web/dist'),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html')));
}

export interface BuiltApp {
  app: FastifyInstance;
  queue: JobQueue;
  cache: CacheStore;
  config: ServerConfig;
}

export async function buildApp(overrides: Partial<ServerConfig> = {}): Promise<BuiltApp> {
  const config = { ...loadConfig(), ...overrides };
  const app = Fastify({
    logger: { level: config.logLevel },
    trustProxy: true,
    bodyLimit: 1024 * 512,
  });

  const cache: CacheStore = config.redisUrl ? new RedisCache(config.redisUrl) : new MemoryCache(20_000);
  const queue = new JobQueue(cache, config.maxConcurrentJobs, config.jobRetentionMs, config.cacheTtlSeconds);

  const webRoot = findWebRoot(config);

  await app.register(helmet, {
    contentSecurityPolicy: webRoot
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
          },
        }
      : false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'DELETE'],
    credentials: false,
  });

  if (config.rateLimitPerMinute > 0) {
    await app.register(rateLimit, {
      max: config.rateLimitPerMinute,
      timeWindow: '1 minute',
      // Health checks and the static metadata routes are exempt: they cost nothing upstream, and
      // counting them means a couple of page loads can lock a user out of the tool itself.
      allowList: (request) =>
        request.url.startsWith('/healthz') ||
        request.url.startsWith('/readyz') ||
        request.url.startsWith('/v1/chains') ||
        request.url.startsWith('/v1/signals') ||
        request.url.startsWith('/v1/version'),
      keyGenerator: (request) => (request.headers.authorization ?? '') || request.ip,
    });
  }

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Wallet Sleuth API',
        version: VERSION,
        description:
          'Wallet linkage analysis for EVM and Solana. Submit public addresses, receive scored links with the on-chain evidence behind each one.',
        license: {
          name: 'Proprietary, all rights reserved',
          url: 'https://github.com/nirholas/wallet-sleuth/blob/main/LICENSE',
        },
      },
      tags: [
        { name: 'analysis', description: 'Submit and retrieve linkage analyses' },
        { name: 'meta', description: 'Capabilities, chains and signal documentation' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', description: 'Required only when SLEUTH_API_KEYS is set' },
        },
      },
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs/api',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  /** Bearer auth, enabled only when keys are configured, so a local run needs no setup. */
  if (config.apiKeys.length > 0) {
    const keys = new Set(config.apiKeys);
    app.addHook('onRequest', async (request, reply) => {
      if (!request.url.startsWith('/v1/')) return;
      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!keys.has(token)) {
        await reply.code(401).send({ error: 'unauthorized', message: 'a valid bearer API key is required' });
      }
    });
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SleuthError) {
      return reply.code(error.status).send({ error: error.code, message: error.message, details: error.details });
    }
    if ((error as unknown as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'too many requests, slow down' });
    }
    request.log.error({ err: error }, 'unhandled error');
    const status = (error as unknown as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({
      error: status >= 500 ? 'internal_error' : 'request_error',
      message: status >= 500 ? 'the server failed to handle this request' : (error as Error).message,
    });
  });

  app.get('/healthz', { schema: { hide: true } }, async () => ({ status: 'ok', version: VERSION }));

  app.get('/readyz', { schema: { hide: true } }, async (_request, reply) => {
    const providers = buildProviders().map((provider) => provider.name);
    const redisOk = cache instanceof RedisCache ? await cache.ping() : true;
    const ready = providers.length > 0 && redisOk;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      version: VERSION,
      providers,
      cache: cache instanceof RedisCache ? (redisOk ? 'redis' : 'redis-unavailable') : 'memory',
      jobs: queue.stats(),
      upstream: schedulerSnapshot(),
    });
  });

  registerAnalysisRoutes(app, queue, config.rateLimitPerMinute > 0 ? config.analyzeRateLimitPerMinute : 0);

  if (webRoot) {
    await app.register(fastifyStatic, { root: webRoot, prefix: '/', index: ['index.html'] });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/v1/') || request.url.startsWith('/healthz')) {
        return reply.code(404).send({ error: 'not_found', message: `no route for ${request.url}` });
      }
      return reply.type('text/html').sendFile('index.html');
    });
    app.log.info({ webRoot }, 'serving the web client');
  } else {
    app.setNotFoundHandler(async (request, reply) =>
      reply.code(404).send({
        error: 'not_found',
        message: `no route for ${request.url}`,
        hint: 'the web client is not built; run `npm run build --workspace @wallet-sleuth/web`',
      }),
    );
  }

  app.addHook('onClose', async () => {
    await queue.close();
    if (cache instanceof RedisCache) await cache.close();
  });

  return { app, queue, cache, config };
}
