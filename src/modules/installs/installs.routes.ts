import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { installScopedRateLimit } from '../../plugins/auth.js';
import { registerInstallBody, registerInstallResponse } from './installs.schemas.js';
import type { InstallsService } from './installs.service.js';

export const installsRoutes: FastifyPluginAsyncZod<{ service: InstallsService }> = async (
  app,
  { service },
) => {
  app.post(
    '/installs',
    {
      schema: {
        tags: ['installs'],
        summary: 'Register (or re-register) an install',
        body: registerInstallBody,
        response: { 200: registerInstallResponse, 201: registerInstallResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { idHash, created } = await service.register(request.body);
      return reply.code(created ? 201 : 200).send(app.issueInstallToken(idHash));
    },
  );

  app.delete(
    '/installs/me',
    {
      schema: {
        tags: ['installs'],
        summary: 'Erase everything stored for this install',
        security: [{ bearerAuth: [] }],
      },
      preHandler: app.requireInstall,
      config: { rateLimit: installScopedRateLimit },
    },
    async (request, reply) => {
      // requireInstall guarantees request.install
      await service.erase(request.install!.idHash);
      return reply.code(204).send();
    },
  );
};
