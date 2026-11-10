import compress from '@fastify/compress';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import { ipRateLimitKey } from '../lib/ip.js';
import { problems } from '../lib/problem.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * onRequest hook applying the global per-IP limit. Routes with their own limiter (per
     * install) add it so the per-IP budget still holds for them.
     */
    limitByIp: (request: FastifyRequest) => Promise<void>;
  }
}

export const securityPlugin = fp<{ config: Config }>(
  async (app, { config }) => {
    // The API serves JSON only: nothing may load or embed anything. /docs gets its own,
    // relaxed policy from @fastify/swagger-ui (see swagger.ts).
    await app.register(helmet, {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'none'"],
        },
      },
    });
    await app.register(compress, { threshold: 1024, encodings: ['br', 'gzip'] });

    // In-memory store (single process). Global limit is per IP (IPv6 by /64); routes override
    // via `config: { rateLimit: { max, timeWindow, keyGenerator? } }` or `rateLimit: false`.
    await app.register(rateLimit, {
      global: true,
      max: config.rateLimitMax,
      timeWindow: '1 minute',
      keyGenerator: (request) => ipRateLimitKey(request.ip),
      errorResponseBuilder: (_request, context) =>
        problems.rateLimited(Math.max(1, Math.ceil(context.ttl / 1000))),
    });

    // createRateLimit() without options shares the global store, so a client's per-IP budget
    // is one number across public and install-scoped routes. (A route-level `rateLimit` config
    // replaces the global limiter, and the plugin runs only one limiter per request, hence the
    // explicit hook.)
    const globalIpLimit = app.createRateLimit();
    app.decorate('limitByIp', async (request: FastifyRequest) => {
      const result = await globalIpLimit(request);
      if (!result.isAllowed && result.isExceeded) {
        throw problems.rateLimited(Math.max(1, Math.ceil(result.ttl / 1000)));
      }
    });
  },
  { name: 'security' },
);
