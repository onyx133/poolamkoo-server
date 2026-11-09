import Fastify, { type FastifyInstance } from 'fastify';
import type { Writable } from 'node:stream';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config.js';
import type { Container } from './container.js';
import { buildLoggerOptions } from './lib/logging.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { installsRoutes } from './modules/installs/installs.routes.js';
import { offersRoutes } from './modules/offers/offers.routes.js';
import { profileRoutes } from './modules/profile/profile.routes.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { genReqId, requestIdPlugin } from './plugins/request-id.js';
import { securityPlugin } from './plugins/security.js';
import { swaggerPlugin } from './plugins/swagger.js';

export const BODY_LIMIT_BYTES = 16 * 1024;

export interface BuildAppOptions {
  /** Test hook: capture log output. */
  logStream?: Writable;
}

export async function buildApp(
  container: Container,
  config: Config,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: buildLoggerOptions(config, options.logStream),
    genReqId,
    // Fastify accepts a hop count at runtime, but its typings omit `number`.
    trustProxy: config.trustProxy as boolean | string | string[],
    bodyLimit: BODY_LIMIT_BYTES,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  // JSON only: drop Fastify's default text/plain parser (unsupported types get a 415).
  app.removeContentTypeParser('text/plain');

  // Plugins (order matters: security before the error handler, swagger before routes).
  await app.register(requestIdPlugin);
  await app.register(securityPlugin, { config });
  await app.register(errorHandlerPlugin);
  await app.register(authPlugin, { config, installs: container.installs });
  await app.register(swaggerPlugin, { config });

  // Modules. WIRE-HERE: register new modules' routes below, all under /v1.
  await app.register(healthRoutes, { prefix: '/v1', service: container.health });
  await app.register(installsRoutes, { prefix: '/v1', service: container.installs });
  await app.register(profileRoutes, { prefix: '/v1', service: container.profile });
  await app.register(offersRoutes, { prefix: '/v1', service: container.offers });

  await app.ready();
  return app;
}
