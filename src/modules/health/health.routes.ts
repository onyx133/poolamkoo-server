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
        summary: 'Liveness probe',
        response: { 200: z.object({ status: z.literal('ok'), version: z.string() }) },
      },
      // Monitoring hits this often: no rate limit, no access log.
      config: { rateLimit: false },
      logLevel: 'silent',
    },
    async () => service.status(),
  );
};
