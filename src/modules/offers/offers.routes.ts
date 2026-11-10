import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { installScoped } from '../../plugins/auth.js';
import { offersResponse } from './offers.schemas.js';
import type { OffersService } from './offers.service.js';

export const offersRoutes: FastifyPluginAsyncZod<{ service: OffersService }> = async (
  app,
  { service },
) => {
  app.get(
    '/offers',
    {
      schema: {
        tags: ['offers'],
        summary: 'Offers for this install',
        description:
          "Active offers matching the install's income band (at most 20, soonest expiry first). Empty without a profile. Never cached.",
        security: [{ bearerAuth: [] }],
        response: { 200: offersResponse },
      },
      ...installScoped(app),
    },
    async (request, reply) => {
      reply.header('cache-control', 'private, no-store');
      return service.listFor(request.install!.idHash);
    },
  );
};
