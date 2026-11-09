import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import type { Config } from '../config.js';

// Must be registered before the route modules so their schemas are collected.
export const swaggerPlugin = fp<{ config: Config }>(
  async (app, { config }) => {
    if (!config.docsEnabled) return;

    await app.register(swagger, {
      openapi: {
        openapi: '3.1.0',
        info: {
          title: 'PoolamKoo API',
          version: config.appVersion,
          description: 'Contract: docs/api/contract-v1.md',
        },
        tags: [
          { name: 'health', description: 'Liveness probe for monitoring' },
          { name: 'installs', description: 'Anonymous install registration and erasure' },
          {
            name: 'profile',
            description: 'Opt-in income band and the published band table',
          },
          { name: 'offers', description: 'Opt-in offers targeted by income band' },
        ],
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  },
  { name: 'swagger' },
);
