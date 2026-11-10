import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fp from 'fastify-plugin';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';
import { z } from 'zod';
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
        components: {
          securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
        },
      },
      transform: (doc) => {
        const out = jsonSchemaTransform(doc);
        // Routes that send raw bytes (catalog, rule packs) document their custom response
        // headers via `schema['x-response-headers'] = { <status>: { <Header>: <JSON schema> } }`.
        const source = (doc.schema ?? {}) as Record<string, unknown>;
        // `schema['x-response-body'] = { <status>: <Zod schema> }` documents the body shape.
        const headers = (source['x-response-headers'] ?? {}) as Record<
          string,
          Record<string, unknown>
        >;
        const bodies = (source['x-response-body'] ?? {}) as Record<string, z.ZodType>;
        if (!out.schema) return out;
        const schema = out.schema as Record<string, unknown>;
        delete schema['x-response-headers'];
        delete schema['x-response-body'];
        const response = (schema['response'] ?? {}) as Record<string, Record<string, unknown>>;
        for (const [status, h] of Object.entries(headers)) {
          response[status] = {
            description: status === '304' ? 'Not modified' : 'Success',
            ...response[status],
            headers: h,
          };
        }
        for (const [status, zodSchema] of Object.entries(bodies)) {
          const json: Record<string, unknown> = z.toJSONSchema(zodSchema, { io: 'output' });
          delete json['$schema'];
          response[status] = { ...response[status], ...json };
        }
        schema['response'] = response;
        return out;
      },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  },
  { name: 'swagger' },
);
