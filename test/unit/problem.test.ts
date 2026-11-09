import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ProblemError, problems, toProblemBody } from '../../src/lib/problem.js';
import { errorHandlerPlugin } from '../../src/plugins/error-handler.js';
import { genReqId, requestIdPlugin } from '../../src/plugins/request-id.js';
import { securityPlugin } from '../../src/plugins/security.js';
import { loadConfig } from '../../src/config.js';

describe('toProblemBody', () => {
  it('uses urn types for slugs and about:blank otherwise', () => {
    expect(toProblemBody(problems.notFound(), 'r1').type).toBe('urn:poolamkoo:problem:not-found');
    expect(toProblemBody(new ProblemError(415, undefined, 'x'), 'r1').type).toBe('about:blank');
  });

  it('includes request_id, title and errors only when present', () => {
    const body = toProblemBody(problems.validation('bad', [{ path: 'a', message: 'm' }]), 'rid');
    expect(body).toEqual({
      type: 'urn:poolamkoo:problem:validation',
      title: 'Bad Request',
      status: 400,
      detail: 'bad',
      request_id: 'rid',
      errors: [{ path: 'a', message: 'm' }],
    });
    expect(toProblemBody(problems.internal(), 'rid')).not.toHaveProperty('errors');
  });

  it('sets Retry-After on rate-limit problems', () => {
    const p = problems.rateLimited(7);
    expect(p.status).toBe(429);
    expect(p.headers['retry-after']).toBe('7');
  });
});

describe('genReqId', () => {
  it('accepts well-formed ids and generates otherwise', () => {
    expect(genReqId({ headers: { 'x-request-id': 'abcd1234-ef' } })).toBe('abcd1234-ef');
    expect(genReqId({ headers: { 'x-request-id': 'short' } })).toMatch(/^[0-9a-f-]{36}$/);
    expect(genReqId({ headers: { 'x-request-id': 'a'.repeat(65) } })).toMatch(/^[0-9a-f-]{36}$/);
    expect(genReqId({ headers: {} })).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// A tiny app with only the error plumbing and a few misbehaving routes.
async function errorApp() {
  const config = loadConfig({
    DATABASE_URL: 'postgresql://x',
    SERVER_PEPPER: 'a'.repeat(64),
    JWT_SECRET: 'b'.repeat(64),
    LOG_LEVEL: 'silent',
  });
  const app = Fastify({
    logger: false,
    genReqId,
    bodyLimit: 1024,
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(requestIdPlugin);
  await app.register(securityPlugin, { config });
  await app.register(errorHandlerPlugin);

  app.post(
    '/validate',
    { schema: { body: z.strictObject({ name: z.string().min(2), age: z.number().int() }) } },
    async () => ({ ok: true }),
  );
  app.get(
    '/query',
    { schema: { querystring: z.object({ n: z.coerce.number().int() }) } },
    async () => ({ ok: true }),
  );
  app.get('/boom', async () => {
    throw new Error('secret database password is hunter2');
  });
  app.get('/problem', async () => {
    throw problems.conflict('already there');
  });
  app.get(
    '/bad-response',
    { schema: { response: { 200: z.object({ a: z.string() }) } } },
    // @ts-expect-error deliberately violates the response schema
    async () => ({ a: 123 }),
  );
  await app.ready();
  return app;
}

describe('error handler', () => {
  it('maps Zod body errors to 400 with errors[] and request_id', async () => {
    const app = await errorApp();
    const res = await app.inject({
      method: 'POST',
      url: '/validate',
      payload: { name: 'x', age: 'old', extra: 1 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.json<{ errors: { path: string }[]; request_id: string; type: string }>();
    expect(body.type).toBe('urn:poolamkoo:problem:validation');
    expect(body.request_id).toBe(res.headers['x-request-id']);
    expect(body.errors.map((e) => e.path)).toEqual(expect.arrayContaining(['name', 'age']));
    expect(body.errors.length).toBeGreaterThanOrEqual(3); // name, age, unknown key
  });

  it('prefixes non-body paths with their origin', async () => {
    const app = await errorApp();
    const res = await app.inject({ method: 'GET', url: '/query?n=abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ errors: { path: string }[] }>().errors[0]?.path).toBe('querystring.n');
  });

  it('renders ProblemError as thrown, with its headers', async () => {
    const app = await errorApp();
    const res = await app.inject({ method: 'GET', url: '/problem' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      type: 'urn:poolamkoo:problem:conflict',
      detail: 'already there',
    });
  });

  it('hides internals of unexpected errors behind a generic 500', async () => {
    const app = await errorApp();
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('hunter2');
    expect(res.json()).toMatchObject({
      type: 'urn:poolamkoo:problem:internal',
      status: 500,
      detail: 'An unexpected error occurred',
    });
  });

  it('turns response-serialization failures into a generic 500', async () => {
    const app = await errorApp();
    const res = await app.inject({ method: 'GET', url: '/bad-response' });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:internal');
  });

  it('returns a 404 problem for unknown routes and 413 for big bodies', async () => {
    const app = await errorApp();
    const nf = await app.inject({ method: 'GET', url: '/nope' });
    expect(nf.statusCode).toBe(404);
    expect(nf.headers['x-request-id']).toBeTruthy();

    const big = await app.inject({
      method: 'POST',
      url: '/validate',
      payload: { name: 'x'.repeat(2000) },
    });
    expect(big.statusCode).toBe(413);
    expect(big.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:payload-too-large');
  });
});
