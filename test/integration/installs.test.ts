import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hmacInstallId } from '../../src/lib/crypto.js';
import { PrismaInstallsRepository } from '../../src/modules/installs/installs.repository.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';
import { bearer, installBody, jwtSub, postInstall, registerInstall } from '../helpers/fixtures.js';
import { signTestJwt } from '../helpers/jwt.js';

describe('installs', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetDb(t.prisma));

  const erase = (headers: Record<string, string>) =>
    t.app.inject({ method: 'DELETE', url: '/v1/installs/me', headers });

  describe('POST /v1/installs', () => {
    it('creates (201) then returns 200 with the same install identity', async () => {
      const first = await registerInstall(t.app);
      expect(first.res.statusCode).toBe(201);
      expect(first.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
      const days = (Date.parse(first.expiresAt) - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);

      const second = await registerInstall(t.app, {
        ...first.body,
        store: 'myket',
        app_version: '0.2.0',
      });
      expect(second.res.statusCode).toBe(200);
      expect(jwtSub(second.token)).toBe(jwtSub(first.token));
      expect(jwtSub(first.token)).toBe(hmacInstallId(first.body.install_id, t.config.serverPepper));

      const rows = await t.prisma.install.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ store: 'myket', appVersion: '0.2.0', platform: 'android' });
    });

    it('issues a JWT with sub, iat, exp and typ=install', async () => {
      const { token } = await registerInstall(t.app);
      const payload = JSON.parse(
        Buffer.from(token.split('.')[1]!, 'base64url').toString(),
      ) as Record<string, unknown>;
      expect(payload['typ']).toBe('install');
      expect(payload['sub']).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof payload['iat']).toBe('number');
      expect(typeof payload['exp']).toBe('number');
    });

    it('never stores the raw install_id; the key is the HMAC', async () => {
      const { body } = await registerInstall(t.app);
      const dump = await t.prisma.$queryRaw<{ row: string }[]>`
        SELECT row_to_json(i)::text AS row FROM installs i`;
      expect(dump).toHaveLength(1);
      expect(dump[0]!.row).not.toContain(body.install_id);
      const [row] = await t.prisma.install.findMany();
      expect(row!.idHash).toBe(hmacInstallId(body.install_id, t.config.serverPepper));
      expect(row!.idHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('treats the install_id case-insensitively', async () => {
      const first = await registerInstall(t.app);
      const upper = await registerInstall(t.app, {
        ...first.body,
        install_id: first.body.install_id.toUpperCase(),
      });
      expect(upper.res.statusCode).toBe(200);
      expect(await t.prisma.install.count()).toBe(1);
    });

    it.each([
      ['not a uuid', { install_id: 'nope' }, 'install_id'],
      ['uuid v1', { install_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' }, 'install_id'],
      ['bad platform', { platform: 'ios' }, 'platform'],
      ['bad store', { store: 'appstore' }, 'store'],
      ['bad version', { app_version: 'latest' }, 'app_version'],
      ['long version', { app_version: `1.0.0-${'x'.repeat(40)}` }, 'app_version'],
    ])('rejects %s with a 400 problem', async (_name, override, path) => {
      const res = await postInstall(t.app, installBody(override));
      expect(res.statusCode).toBe(400);
      expect(res.headers['content-type']).toContain('application/problem+json');
      const problem = res.json<{
        type: string;
        status: number;
        request_id: string;
        errors: { path: string; message: string }[];
      }>();
      expect(problem.type).toBe('urn:poolamkoo:problem:validation');
      expect(problem.status).toBe(400);
      expect(problem.request_id).toBe(res.headers['x-request-id']);
      expect(problem.errors.map((e) => e.path)).toContain(path);
      expect(await t.prisma.install.count()).toBe(0);
    });

    it('rejects unknown keys and a missing body', async () => {
      const extra = await postInstall(t.app, installBody({ phone: '09120000000' }));
      expect(extra.statusCode).toBe(400);

      const empty = await postInstall(t.app);
      expect(empty.statusCode).toBe(400);
      expect(empty.headers['content-type']).toContain('application/problem+json');
    });

    it('rejects malformed JSON and non-JSON content types', async () => {
      const bad = await postInstall(t.app, '{not json', { 'content-type': 'application/json' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:validation');

      const text = await postInstall(t.app, 'hello', { 'content-type': 'text/plain' });
      expect(text.statusCode).toBe(415);
      expect(text.headers['content-type']).toContain('application/problem+json');
      expect(text.json<{ type: string }>().type).toBe('about:blank');
    });
  });

  describe('requireInstall', () => {
    it('rejects a missing token with a 401 problem', async () => {
      const res = await erase({});
      expect(res.statusCode).toBe(401);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.headers['www-authenticate']).toBe('Bearer');
      expect(res.json<{ type: string }>().type).toBe('urn:poolamkoo:problem:unauthorized');
    });

    it('rejects garbage, non-bearer and wrongly signed tokens', async () => {
      expect((await erase(bearer('garbage'))).statusCode).toBe(401);
      expect((await erase({ authorization: 'Basic abc' })).statusCode).toBe(401);
      const forged = signTestJwt(
        { typ: 'install', sub: 'a'.repeat(64) },
        Buffer.from('c'.repeat(64)),
      );
      expect((await erase(bearer(forged))).statusCode).toBe(401);
    });

    it('rejects an expired token', async () => {
      const { body } = await registerInstall(t.app);
      const now = Math.floor(Date.now() / 1000);
      const expired = signTestJwt(
        {
          typ: 'install',
          sub: hmacInstallId(body.install_id, t.config.serverPepper),
          iat: now - 7200,
          exp: now - 3600,
        },
        t.config.jwtSecret,
      );
      expect((await erase(bearer(expired))).statusCode).toBe(401);
      expect(await t.prisma.install.count()).toBe(1);
    });

    it('rejects a validly signed token of another type or shape', async () => {
      const exp = Math.floor(Date.now() / 1000) + 600;
      const wrongTyp = signTestJwt({ typ: 'admin', sub: 'a'.repeat(64), exp }, t.config.jwtSecret);
      expect((await erase(bearer(wrongTyp))).statusCode).toBe(401);
      const wrongSub = signTestJwt({ typ: 'install', sub: 'x', exp }, t.config.jwtSecret);
      expect((await erase(bearer(wrongSub))).statusCode).toBe(401);
    });

    it('rejects a validly signed token without an expiry', async () => {
      const noExp = signTestJwt({ typ: 'install', sub: 'a'.repeat(64) }, t.config.jwtSecret);
      expect((await erase(bearer(noExp))).statusCode).toBe(401);
      // Even for an install that exists: a token that never expires is not accepted.
      const { body } = await registerInstall(t.app);
      const sub = hmacInstallId(body.install_id, t.config.serverPepper);
      const forever = signTestJwt({ typ: 'install', sub }, t.config.jwtSecret);
      expect((await erase(bearer(forever))).statusCode).toBe(401);
      expect(await t.prisma.install.count()).toBe(1);
    });

    it('rejects a valid token whose install no longer exists', async () => {
      const { token } = await registerInstall(t.app);
      await t.prisma.install.deleteMany();
      expect((await erase(bearer(token))).statusCode).toBe(401);
    });
  });

  describe('DELETE /v1/installs/me', () => {
    it('accepts Content-Type: application/json with an empty body (OkHttp style)', async () => {
      const { token } = await registerInstall(t.app);
      const res = await erase({ ...bearer(token), 'content-type': 'application/json' });
      expect(res.statusCode).toBe(204);
      expect(await t.prisma.install.count()).toBe(0);
    });

    it('still answers 400 for malformed JSON', async () => {
      const { token } = await registerInstall(t.app);
      const res = await t.app.inject({
        method: 'DELETE',
        url: '/v1/installs/me',
        headers: { ...bearer(token), 'content-type': 'application/json' },
        payload: '{oops',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ type: 'urn:poolamkoo:problem:validation' });
    });

    it('still answers 401 before parsing a malformed body', async () => {
      const res = await t.app.inject({
        method: 'DELETE',
        url: '/v1/installs/me',
        headers: { 'content-type': 'application/json' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('erases the install and its profile, and invalidates the token', async () => {
      const { token } = await registerInstall(t.app);
      const [install] = await t.prisma.install.findMany();
      await t.prisma.profile.create({
        data: {
          installIdHash: install!.idHash,
          incomeBand: 'B2',
          period: '1405-08',
          consentVersion: 1,
        },
      });

      const res = await erase(bearer(token));
      expect(res.statusCode).toBe(204);
      expect(res.body).toBe('');
      expect(await t.prisma.install.count()).toBe(0);
      expect(await t.prisma.profile.count()).toBe(0);

      expect((await erase(bearer(token))).statusCode).toBe(401);
    });
  });

  describe('PrismaInstallsRepository', () => {
    it('reads and touches last_seen_on', async () => {
      const repo = new PrismaInstallsRepository(t.prisma);
      const idHash = 'f'.repeat(64);
      expect(await repo.findLastSeenOn(idHash)).toBeNull();

      const input = {
        idHash,
        platform: 'android' as const,
        appVersion: '1.0.0',
        store: 'play' as const,
        lastSeenOn: '2020-01-01',
      };
      expect(await repo.upsert(input)).toBe(true);
      expect(await repo.upsert({ ...input, lastSeenOn: '2020-01-02' })).toBe(false);
      expect(await repo.findLastSeenOn(idHash)).toBe('2020-01-02');

      await repo.touchLastSeenOn(idHash, '2020-02-03');
      expect(await repo.findLastSeenOn(idHash)).toBe('2020-02-03');

      await repo.delete(idHash);
      await repo.delete(idHash); // idempotent
      expect(await repo.findLastSeenOn(idHash)).toBeNull();
    });
  });
});
