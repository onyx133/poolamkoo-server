import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';
import { bearer, jwtSub, registerInstall } from '../helpers/fixtures.js';

const profileBody = (overrides: Record<string, unknown> = {}) => ({
  income_band: 'B3',
  period: '1405-08',
  consent_version: 1,
  ...overrides,
});

describe('profile', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetDb(t.prisma));

  const put = (headers: Record<string, string>, payload?: unknown) =>
    t.app.inject({
      method: 'PUT',
      url: '/v1/installs/me/profile',
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const del = (headers: Record<string, string>) =>
    t.app.inject({ method: 'DELETE', url: '/v1/installs/me/profile', headers });

  describe('PUT /v1/installs/me/profile', () => {
    it('stores the profile (204) and keeps only the latest value', async () => {
      const { token } = await registerInstall(t.app);

      const first = await put(bearer(token), profileBody());
      expect(first.statusCode).toBe(204);
      expect(first.body).toBe('');

      const second = await put(
        bearer(token),
        profileBody({ income_band: 'B5', period: '1405-09', consent_version: 2 }),
      );
      expect(second.statusCode).toBe(204);

      const rows = await t.prisma.profile.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        installIdHash: jwtSub(token),
        incomeBand: 'B5',
        period: '1405-09',
        consentVersion: 2,
      });
    });

    it('keeps one row per install', async () => {
      const a = await registerInstall(t.app);
      const b = await registerInstall(t.app);
      await put(bearer(a.token), profileBody({ income_band: 'B1' }));
      await put(bearer(b.token), profileBody({ income_band: 'B2' }));
      const rows = await t.prisma.profile.findMany({ orderBy: { incomeBand: 'asc' } });
      expect(rows.map((r) => r.incomeBand)).toEqual(['B1', 'B2']);
    });

    it.each([
      ['unknown band', { income_band: 'B6' }, 'income_band'],
      ['lowercase band', { income_band: 'b1' }, 'income_band'],
      ['bad period format', { period: '1405-8' }, 'period'],
      ['period month 13', { period: '1405-13' }, 'period'],
      ['period month 00', { period: '1405-00' }, 'period'],
      ['period with suffix', { period: '1405-08-01' }, 'period'],
      ['zero consent', { consent_version: 0 }, 'consent_version'],
      ['fractional consent', { consent_version: 1.5 }, 'consent_version'],
      ['string consent', { consent_version: '1' }, 'consent_version'],
      ['missing band', { income_band: undefined }, 'income_band'],
    ])('rejects %s with a 400 problem', async (_name, override, path) => {
      const { token } = await registerInstall(t.app);
      const res = await put(bearer(token), profileBody(override));
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const problem = res.json<{ type: string; errors: { path: string }[] }>();
      expect(problem.type).toBe('urn:poolamkoo:problem:validation');
      expect(problem.errors.map((e) => e.path)).toContain(path);
      expect(await t.prisma.profile.count()).toBe(0);
    });

    it('rejects unknown keys and a missing body', async () => {
      const { token } = await registerInstall(t.app);
      const extra = await put(bearer(token), profileBody({ income: 123_000_000 }));
      expect(extra.statusCode).toBe(400);
      expect((await put(bearer(token))).statusCode).toBe(400);
      expect(await t.prisma.profile.count()).toBe(0);
    });
  });

  describe('DELETE /v1/installs/me/profile', () => {
    it('removes the profile and is idempotent', async () => {
      const { token } = await registerInstall(t.app);
      await put(bearer(token), profileBody());
      expect(await t.prisma.profile.count()).toBe(1);

      expect((await del(bearer(token))).statusCode).toBe(204);
      expect(await t.prisma.profile.count()).toBe(0);
      const again = await del(bearer(token));
      expect(again.statusCode).toBe(204);
      expect(again.body).toBe('');
      // The install itself stays
      expect(await t.prisma.install.count()).toBe(1);
    });

    it('only removes the caller’s profile', async () => {
      const a = await registerInstall(t.app);
      const b = await registerInstall(t.app);
      await put(bearer(a.token), profileBody());
      await put(bearer(b.token), profileBody());
      await del(bearer(a.token));
      const rows = await t.prisma.profile.findMany();
      expect(rows.map((r) => r.installIdHash)).toEqual([jwtSub(b.token)]);
    });
  });

  describe('auth', () => {
    it('answers 401 problems without a token or with a bad one', async () => {
      for (const headers of [{}, bearer('garbage'), { authorization: 'Basic abc' }]) {
        for (const res of [await put(headers, profileBody()), await del(headers)]) {
          expect(res.statusCode).toBe(401);
          expect(res.headers['content-type']).toContain('application/problem+json');
          expect(res.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:unauthorized');
        }
      }
      expect(await t.prisma.profile.count()).toBe(0);
    });

    it('checks auth before validating the body', async () => {
      const res = await put({}, { nonsense: true });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /v1/installs/me', () => {
    it('cascades to the profile and invalidates the token', async () => {
      const { token } = await registerInstall(t.app);
      await put(bearer(token), profileBody());
      expect(await t.prisma.profile.count()).toBe(1);

      const erased = await t.app.inject({
        method: 'DELETE',
        url: '/v1/installs/me',
        headers: bearer(token),
      });
      expect(erased.statusCode).toBe(204);
      expect(await t.prisma.profile.count()).toBe(0);

      expect((await put(bearer(token), profileBody())).statusCode).toBe(401);
      expect((await del(bearer(token))).statusCode).toBe(401);
      expect(await t.prisma.profile.count()).toBe(0);
    });
  });

  describe('GET /v1/profile/bands', () => {
    const seedBands = (version: number, firstMax = 150_000_000) =>
      t.prisma.bandTable.create({
        data: {
          version,
          currency: 'IRR',
          bands: [
            { key: 'B1', max_monthly_net_income: firstMax },
            { key: 'B2', max_monthly_net_income: null },
          ],
        },
      });
    const get = (headers: Record<string, string> = {}) =>
      t.app.inject({ method: 'GET', url: '/v1/profile/bands', headers });

    it('serves the latest table with ETag and Cache-Control, without auth', async () => {
      await seedBands(1, 100);
      await seedBands(2, 200);
      const res = await get();
      expect(res.statusCode).toBe(200);
      expect(res.headers['etag']).toBe('"bands-2"');
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
      expect(res.json()).toEqual({
        version: 2,
        currency: 'IRR',
        bands: [
          { key: 'B1', max_monthly_net_income: 200 },
          { key: 'B2', max_monthly_net_income: null },
        ],
      });
    });

    it('answers 304 for a matching If-None-Match (weak, list, wildcard)', async () => {
      await seedBands(3);
      for (const header of ['"bands-3"', 'W/"bands-3"', '"bands-1", "bands-3"', '*']) {
        const res = await get({ 'if-none-match': header });
        expect(res.statusCode).toBe(304);
        expect(res.body).toBe('');
        expect(res.headers['etag']).toBe('"bands-3"');
        expect(res.headers['cache-control']).toBe('public, max-age=3600');
      }
    });

    it('answers 200 for a stale If-None-Match and when a newer version appears', async () => {
      await seedBands(3);
      expect((await get({ 'if-none-match': '"bands-2"' })).statusCode).toBe(200);
      await seedBands(4);
      const res = await get({ 'if-none-match': '"bands-3"' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['etag']).toBe('"bands-4"');
    });

    it('answers a 404 problem when no table exists', async () => {
      const res = await get();
      expect(res.statusCode).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:not-found');
    });
  });

  describe('install-scoped rate limiting', () => {
    it('limits each install to 60/min (keyed by JWT sub), independent of the IP', async () => {
      const fresh = await buildTestApp();
      try {
        const a = await registerInstall(fresh.app);
        const b = await registerInstall(fresh.app);
        const call = (token: string, remoteAddress: string) =>
          fresh.app.inject({
            method: 'DELETE',
            url: '/v1/installs/me/profile',
            headers: bearer(token),
            remoteAddress,
          });

        for (let i = 0; i < 60; i++)
          expect((await call(a.token, '203.0.113.7')).statusCode).toBe(204);
        const limited = await call(a.token, '203.0.113.7');
        expect(limited.statusCode).toBe(429);
        expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(limited.headers['content-type']).toContain('application/problem+json');
        expect(limited.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:rate-limited');

        // Same install from another IP is still limited; another install from the
        // original IP is not.
        expect((await call(a.token, '203.0.113.99')).statusCode).toBe(429);
        expect((await call(b.token, '203.0.113.7')).statusCode).toBe(204);
      } finally {
        await fresh.close();
      }
    }, 60_000);
  });
});
