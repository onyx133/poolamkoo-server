import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { matchesIfNoneMatch } from '../../lib/http-cache.js';
import { problems } from '../../lib/problem.js';
import { catalogSchema } from './catalog.schemas.js';
import type { CatalogService } from './catalog.service.js';

export const CATALOG_CACHE_CONTROL = 'public, max-age=300';

export const catalogRoutes: FastifyPluginAsyncZod<{ service: CatalogService }> = async (
  app,
  { service },
) => {
  app.get(
    '/catalog',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Category taxonomy, merchant directory and icon set',
        description:
          'The latest catalog release, served byte-for-byte as stored. Send `If-None-Match` ' +
          'with the last `ETag` to get `304 Not Modified`. 404 until a first catalog is imported.',
        // Documentation only (see plugins/swagger.ts): the body is a pre-serialized Buffer, so
        // no Fastify response schema is declared (it would also type `send` to the object).
        'x-response-body': { 200: catalogSchema },
        'x-response-headers': {
          200: {
            ETag: { type: 'string', description: 'Quoted `"catalog-<version>"`.' },
            'Cache-Control': { type: 'string', description: CATALOG_CACHE_CONTROL },
          },
          304: { ETag: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      const release = await service.latest();
      if (!release) throw problems.notFound('No catalog has been published yet');

      reply.header('etag', release.etag).header('cache-control', CATALOG_CACHE_CONTROL);
      if (matchesIfNoneMatch(request.headers['if-none-match'], release.etag)) {
        return reply.code(304).send();
      }
      return reply.type('application/json; charset=utf-8').send(release.body);
    },
  );
};
