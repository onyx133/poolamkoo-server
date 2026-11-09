import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { matchesIfNoneMatch } from '../../lib/http-cache.js';
import { problems } from '../../lib/problem.js';
import { installScopedRateLimit } from '../../plugins/auth.js';
import { bandTableResponse, putProfileBody } from './profile.schemas.js';
import { bandsEtag, type ProfileService } from './profile.service.js';

const BANDS_CACHE_CONTROL = 'public, max-age=3600';

export const profileRoutes: FastifyPluginAsyncZod<{ service: ProfileService }> = async (
  app,
  { service },
) => {
  app.put(
    '/installs/me/profile',
    {
      schema: {
        tags: ['profile'],
        summary: 'Set the opt-in income band',
        description:
          'Stores only the latest value (band, Jalali period, consent version). Call only after the user opted in.',
        security: [{ bearerAuth: [] }],
        body: putProfileBody,
      },
      onRequest: app.requireInstall,
      config: { rateLimit: installScopedRateLimit },
    },
    async (request, reply) => {
      await service.put(request.install!.idHash, request.body);
      return reply.code(204).send();
    },
  );

  app.delete(
    '/installs/me/profile',
    {
      schema: {
        tags: ['profile'],
        summary: 'Remove the stored profile (opt-out)',
        description: 'Idempotent: 204 even when no profile exists.',
        security: [{ bearerAuth: [] }],
      },
      onRequest: app.requireInstall,
      config: { rateLimit: installScopedRateLimit },
    },
    async (request, reply) => {
      await service.remove(request.install!.idHash);
      return reply.code(204).send();
    },
  );

  app.get(
    '/profile/bands',
    {
      schema: {
        tags: ['profile'],
        summary: 'Income band edges',
        description:
          'Latest published band table. Cacheable: send If-None-Match to get 304. The device maps its own income to a band locally.',
        response: { 200: bandTableResponse, 304: z.undefined().describe('Not modified') },
      },
    },
    async (request, reply) => {
      const table = await service.bands();
      if (!table) throw problems.notFound('No band table has been published');
      const etag = bandsEtag(table.version);
      reply.header('etag', etag).header('cache-control', BANDS_CACHE_CONTROL);
      if (matchesIfNoneMatch(request.headers['if-none-match'], etag)) {
        return reply.code(304).send();
      }
      return table;
    },
  );
};
