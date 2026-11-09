import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

export function installBody(overrides: Record<string, unknown> = {}): {
  install_id: string;
  [key: string]: unknown;
} {
  return {
    install_id: randomUUID(),
    platform: 'android',
    app_version: '0.1.0',
    store: 'bazaar',
    ...overrides,
  };
}

// POST /v1/installs is limited to 10/min per IP, so every test request comes from a fresh IP.
let ipCounter = 0;
export const nextIp = () => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

export function postInstall(
  app: FastifyInstance,
  payload?: unknown,
  headers: Record<string, string> = {},
) {
  return app.inject({
    method: 'POST',
    url: '/v1/installs',
    remoteAddress: nextIp(),
    headers,
    ...(payload === undefined ? {} : { payload: payload as object | string }),
  });
}

export async function registerInstall(app: FastifyInstance, body = installBody()) {
  const res = await postInstall(app, body);
  const json = res.json<{ access_token: string; expires_at: string }>();
  return { res, body, token: json.access_token, expiresAt: json.expires_at };
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export function jwtSub(token: string): string {
  const payload = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as {
    sub: string;
  };
  return payload.sub;
}
