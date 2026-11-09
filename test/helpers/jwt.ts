import { createHmac } from 'node:crypto';

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

// Hand-rolled HS256 token so tests can mint expired or odd tokens.
export function signTestJwt(payload: Record<string, unknown>, secret: Buffer): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
