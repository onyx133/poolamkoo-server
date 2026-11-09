import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { bearer, installBody, postInstall, registerInstall } from '../helpers/fixtures.js';

// Cross-cutting behaviour: request ids, error shape, limits, logging, docs.
describe('platform', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());

  describe('X-Request-Id', () => {
    it('is present on success, validation errors, 401 and 404', async () => {
      const ok = await t.app.inject({ method: 'GET', url: '/v1/health' });
      const bad = await postInstall(t.app, {});
      const unauth = await t.app.inject({ method: 'DELETE', url: '/v1/installs/me' });
      const missing = await t.app.inject({ method: 'GET', url: '/v1/nope' });
      for (const res of [ok, bad, unauth, missing]) {
        expect(res.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
      }
      expect(missing.json<{ request_id: string }>().request_id).toBe(
        missing.headers['x-request-id'],
      );
    });

    it('honours a well-formed incoming id and replaces a malformed one', async () => {
      const good = await t.app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { 'x-request-id': 'abc-12345678' },
      });
      expect(good.headers['x-request-id']).toBe('abc-12345678');

      const bad = await t.app.inject({
        method: 'GET',
        url: '/v1/health',
        headers: { 'x-request-id': 'bad id with spaces' },
      });
      expect(bad.headers['x-request-id']).not.toBe('bad id with spaces');
      expect(bad.headers['x-request-id']).toMatch(/^[A-Za-z0-9-]{8,64}$/);
    });
  });

  it('answers unknown routes with a 404 problem', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json()).toMatchObject({
      type: 'urn:poolamkoo:problem:not-found',
      title: 'Not Found',
      status: 404,
    });
  });

  it('rejects bodies over 16 KiB with a 413 problem', async () => {
    const res = await postInstall(t.app, installBody({ app_version: 'x'.repeat(17 * 1024) }));
    expect(res.statusCode).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:payload-too-large');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('sets security headers and compresses large responses', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeTruthy();

    const spec = await t.app.inject({
      method: 'GET',
      url: '/docs/json',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(spec.statusCode).toBe(200);
    expect(spec.headers['content-encoding']).toBe('gzip');
  });

  describe('rate limiting', () => {
    it('returns 429 + Retry-After + problem body past the global per-IP limit', async () => {
      const small = await buildTestApp({ env: { RATE_LIMIT_MAX: '2' } });
      try {
        const hit = () => small.app.inject({ method: 'GET', url: '/v1/nope' });
        expect((await hit()).statusCode).toBe(404);
        expect((await hit()).statusCode).toBe(404);
        const limited = await hit();
        expect(limited.statusCode).toBe(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(limited.headers['content-type']).toContain('application/problem+json');
        expect(limited.headers['x-request-id']).toBeTruthy();
        expect(limited.json()).toMatchObject({
          type: 'urn:poolamkoo:problem:rate-limited',
          status: 429,
          request_id: limited.headers['x-request-id'],
        });
      } finally {
        await small.close();
      }
    });

    it('limits POST /v1/installs to 10 per minute per IP', async () => {
      const fresh = await buildTestApp();
      try {
        const post = () =>
          fresh.app.inject({
            method: 'POST',
            url: '/v1/installs',
            remoteAddress: '203.0.113.50',
            payload: {},
          });
        for (let i = 0; i < 10; i++) expect((await post()).statusCode).toBe(400);
        const limited = await post();
        expect(limited.statusCode).toBe(429);
        expect(limited.headers['retry-after']).toBeTruthy();
      } finally {
        await fresh.close();
      }
    });

    it('keys install-scoped routes by the JWT subject, not the IP', async () => {
      const fresh = await buildTestApp();
      try {
        const a = await registerInstall(fresh.app);
        const b = await registerInstall(fresh.app);
        // 60/min per install: exhaust A with unauthenticated-but-verified calls is not
        // possible without a second route, so check the key function directly.
        const { installRateLimitKey } = await import('../../src/plugins/auth.js');
        const keyFor = (token: string) =>
          installRateLimitKey({
            headers: bearer(token),
            ip: '203.0.113.9',
            server: fresh.app,
          } as never);
        expect(keyFor(a.token)).not.toBe(keyFor(b.token));
        expect(keyFor(a.token)).toMatch(/^install:/);
        expect(keyFor('garbage')).toBe('203.0.113.9');
      } finally {
        await fresh.close();
      }
    });
  });

  describe('logging', () => {
    it('never logs IPs, authorization headers, tokens, install ids or bodies', async () => {
      const lines: string[] = [];
      const logStream = new Writable({
        write(chunk: Buffer, _enc, cb) {
          lines.push(chunk.toString());
          cb();
        },
      });
      const logged = await buildTestApp({ env: { LOG_LEVEL: 'info' }, logStream });
      try {
        const reg = await registerInstall(logged.app);
        await logged.app.inject({
          method: 'DELETE',
          url: '/v1/installs/me',
          headers: { ...bearer(reg.token), 'x-forwarded-for': '198.51.100.77' },
          remoteAddress: '192.0.2.55',
        });
        await postInstall(logged.app, { bad: 1 });
        await logged.app.inject({ method: 'GET', url: '/v1/health' });

        const output = lines.join('');
        expect(output).toContain('"statusCode":201');
        expect(output).not.toContain(reg.token);
        expect(output).not.toContain(reg.body.install_id);
        expect(output).not.toMatch(/authorization/i);
        expect(output).not.toContain('192.0.2.55');
        expect(output).not.toContain('198.51.100.77');
        expect(output).not.toContain('127.0.0.1');
        expect(output).not.toContain('"bad"');
        expect(output).not.toContain('/v1/health'); // health is excluded from access logs
      } finally {
        await logged.close();
      }
    });
  });

  describe('docs', () => {
    it('serves the OpenAPI document when enabled', async () => {
      const res = await t.app.inject({ method: 'GET', url: '/docs/json' });
      expect(res.statusCode).toBe(200);
      const spec = res.json<{ openapi: string; paths: Record<string, unknown> }>();
      expect(spec.openapi).toMatch(/^3\.1/);
      expect(Object.keys(spec.paths)).toEqual(
        expect.arrayContaining(['/v1/health', '/v1/installs', '/v1/installs/me']),
      );
    });

    it('is off when DOCS_ENABLED=false', async () => {
      const off = await buildTestApp({ env: { DOCS_ENABLED: 'false' } });
      try {
        const res = await off.app.inject({ method: 'GET', url: '/docs/json' });
        expect(res.statusCode).toBe(404);
      } finally {
        await off.close();
      }
    });
  });
});
