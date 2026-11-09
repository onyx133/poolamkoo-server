import type { FastifyServerOptions } from 'fastify';
import type { Writable } from 'node:stream';
import type { Config } from '../config.js';

// Logs must never contain IPs, auth headers or bodies. The serializers whitelist fields
// (so the default remoteAddress/remotePort never appear) and redact is a second net.
export function buildLoggerOptions(
  config: Config,
  stream?: Writable,
): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level: config.logLevel,
    redact: {
      paths: [
        'req.headers',
        'res.headers',
        'req.body',
        'res.body',
        'req.ip',
        'req.remoteAddress',
        '*.authorization',
        '*.token',
        '*.access_token',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req: (request: { method?: string; url?: string; routeOptions?: { url?: string } }) => ({
        method: request.method,
        route: request.routeOptions?.url,
        path: request.url?.split('?')[0],
      }),
      res: (reply: { statusCode?: number }) => ({ statusCode: reply.statusCode }),
    },
    ...(stream ? { stream } : {}),
  };
}
