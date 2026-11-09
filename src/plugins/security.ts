import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import { problems } from '../lib/problem.js';

export const securityPlugin = fp<{ config: Config }>(
  async (app, { config }) => {
    // The API serves JSON only; /docs gets its own CSP from @fastify/swagger-ui.
    await app.register(helmet);
    await app.register(compress, { threshold: 1024, encodings: ['br', 'gzip'] });

    // In-memory store (single process). Global limit is per IP; routes override via
    // `config: { rateLimit: { max, timeWindow, keyGenerator? } }` or `rateLimit: false`.
    await app.register(rateLimit, {
      global: true,
      max: config.rateLimitMax,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.ip,
      errorResponseBuilder: (_request, context) =>
        problems.rateLimited(Math.max(1, Math.ceil(context.ttl / 1000))),
    });
  },
  { name: 'security' },
);
