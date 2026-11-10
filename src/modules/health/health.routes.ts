import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HealthService } from './health.service.js';

export const healthRoutes: FastifyPluginAsyncZod<{ service: HealthService }> = async (
  app,
  { service },
) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness and database probe',
        description: '`503` with `status: "degraded"` when the database does not answer in time.',
        response: {
          200: z.object({ status: z.literal('ok'), version: z.string() }),
          503: z.object({ status: z.literal('degraded'), version: z.string() }),
        },
      },
      // Monitoring hits this often: no rate limit, no access log.
      config: { rateLimit: false },
      logLevel: 'silent',
    },
    async (_request, reply) => {
      const result = await service.status();
      return reply.code(result.status === 'ok' ? 200 : 503).send(result);
    },
  );
};
