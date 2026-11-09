import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { matchesIfNoneMatch } from '../../lib/http-cache.js';
import { problems } from '../../lib/problem.js';
import { rulePackEtag, type RulePacksService } from './rule-packs.service.js';

const CACHE_CONTROL = 'public, max-age=300';

// Digits only: rejects "", "-1", "1.5", "1e3", "0x10" and friends. int32 range (versionCode).
const latestQuery = z.strictObject({
  app_version: z
    .string()
    .regex(/^\d{1,10}$/, 'must be a non-negative integer (the Android versionCode)')
    .transform(Number)
    .pipe(z.number().int().max(2_147_483_647)),
});

export const rulePacksRoutes: FastifyPluginAsyncZod<{ service: RulePacksService }> = async (
  app,
  { service },
) => {
  app.get(
    '/rule-packs/latest',
    {
      schema: {
        tags: ['rule-packs'],
        summary: 'Newest signed SMS rule pack the app version supports',
        description:
          'The newest pack whose `minAppVersion` is at most `app_version`, as the exact stored ' +
          'bytes (`application/json`). `X-Signature` is a base64 detached Ed25519 signature over ' +
          'those bytes. Send `If-None-Match` for `304`. 404 when no pack fits.',
        querystring: latestQuery,
        'x-response-headers': {
          200: {
            'X-Rule-Pack-Version': { type: 'integer', description: 'The pack `version`.' },
            'X-Signature': {
              type: 'string',
              description: 'Base64 Ed25519 signature over the response body bytes.',
            },
            ETag: { type: 'string', description: 'Quoted `"rulepack-<version>"`.' },
            'Cache-Control': { type: 'string', description: CACHE_CONTROL },
          },
          304: {
            ETag: { type: 'string' },
            'X-Rule-Pack-Version': { type: 'integer' },
            'X-Signature': { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const pack = await service.latestFor(request.query.app_version);
      if (!pack) throw problems.notFound('No rule pack is available for this app version');

      const etag = rulePackEtag(pack.version);
      reply
        .header('etag', etag)
        .header('cache-control', CACHE_CONTROL)
        .header('x-rule-pack-version', String(pack.version))
        .header('x-signature', pack.signature);
      if (matchesIfNoneMatch(request.headers['if-none-match'], etag)) {
        return reply.code(304).send();
      }
      return reply.type('application/json').send(pack.payload);
    },
  );
};
