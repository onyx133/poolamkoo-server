import fastifyJwt from '@fastify/jwt';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Config } from '../config.js';
import { problems } from '../lib/problem.js';
import type { InstallsService } from '../modules/installs/installs.service.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { typ: 'install'; sub: string };
    user: { typ: 'install'; sub: string };
  }
}

export interface InstallIdentity {
  idHash: string;
}

export interface IssuedToken {
  access_token: string;
  expires_at: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler for install-scoped routes: verified JWT + install row exists. */
    requireInstall: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    issueInstallToken: (idHash: string) => IssuedToken;
  }
  interface FastifyRequest {
    /** Set by requireInstall. */
    install?: InstallIdentity;
  }
}

const ID_HASH = /^[0-9a-f]{64}$/;

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  const match = header ? /^Bearer (\S+)$/.exec(header) : null;
  return match?.[1];
}

// Rate-limit key for install-scoped routes: the verified JWT subject, falling back to the
// IP when the token is missing/invalid (those requests fail with 401 anyway). The token is
// verified, never just decoded, so a caller cannot choose someone else's bucket.
export function installRateLimitKey(request: FastifyRequest): string {
  const token = bearerToken(request);
  if (token) {
    try {
      const payload = request.server.jwt.verify<{ typ?: string; sub?: string }>(token);
      if (payload.typ === 'install' && payload.sub) return `install:${payload.sub}`;
    } catch {
      // fall through to IP
    }
  }
  return request.ip;
}

// Route-level rate-limit config for install-scoped routes (60/min per install).
export const installScopedRateLimit = {
  max: 60,
  timeWindow: '1 minute',
  keyGenerator: installRateLimitKey,
} as const;

export const authPlugin = fp<{ config: Config; installs: InstallsService }>(
  async (app, { config, installs }) => {
    await app.register(fastifyJwt, {
      secret: config.jwtSecret,
      sign: { algorithm: 'HS256' },
      verify: { algorithms: ['HS256'] },
    });

    app.decorate('issueInstallToken', (idHash: string): IssuedToken => {
      const accessToken = app.jwt.sign(
        { typ: 'install', sub: idHash },
        { expiresIn: config.jwtTtlDays * 24 * 3600 }, // seconds,
      );
      const exp = app.jwt.decode<{ exp: number }>(accessToken)?.exp ?? 0;
      return {
        access_token: accessToken,
        expires_at: new Date(exp * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      };
    });

    app.decorateRequest('install', undefined);

    app.decorate('requireInstall', async (request: FastifyRequest) => {
      let payload: { typ: string; sub: string };
      try {
        payload = await request.jwtVerify<{ typ: string; sub: string }>();
      } catch {
        throw problems.unauthorized('Missing, invalid or expired access token');
      }
      if (payload.typ !== 'install' || !ID_HASH.test(payload.sub)) {
        throw problems.unauthorized('Missing, invalid or expired access token');
      }
      // Erased installs fail here so the app knows to re-register.
      if (!(await installs.authenticate(payload.sub))) {
        throw problems.unauthorized('Install is not registered');
      }
      request.install = { idHash: payload.sub };
    });
  },
  { name: 'auth' },
);
