import { afterEach, describe, expect, it, vi } from 'vitest';
import { hmacInstallId } from '../../src/lib/crypto.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { bearer, registerInstall } from '../helpers/fixtures.js';
import { signTestJwt } from '../helpers/jwt.js';

// Install-scoped routes: the limiters run before authentication, so failed attempts count and
// an over-limit flood never reaches the database.
describe('rate limits on install-scoped routes', () => {
  let t: TestApp | undefined;
  afterEach(async () => {
    vi.restoreAllMocks();
    await t?.close();
    t = undefined;
  });

  const ROUTES = [
    { method: 'GET', url: '/v1/offers' },
    { method: 'DELETE', url: '/v1/installs/me' },
    { method: 'DELETE', url: '/v1/installs/me/profile' },
    {
      method: 'PUT',
      url: '/v1/installs/me/profile',
      payload: { income_band: 'B1', period: '1405-08', consent_version: 1 },
    },
  ] as const;

  const flood = async (
    app: TestApp['app'],
    route: (typeof ROUTES)[number],
    headers: Record<string, string>,
    count: number,
    remoteAddress = '203.0.113.20',
  ) => {
    const codes: number[] = [];
    let last: Awaited<ReturnType<typeof app.inject>> | undefined;
    for (let i = 0; i < count; i++) {
      last = await app.inject({ ...route, headers, remoteAddress });
      codes.push(last.statusCode);
    }
    return { codes, last: last! };
  };

  it.each(ROUTES)('answers 429 after 60 bad-token requests to $method $url', async (route) => {
    t = await buildTestApp();
    const { codes, last } = await flood(t.app, route, bearer('garbage'), 62);
    expect(codes.slice(0, 60).every((c) => c === 401)).toBe(true);
    expect(codes.slice(60)).toEqual([429, 429]);
    expect(Number(last.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(last.json()).toMatchObject({ type: 'urn:poolamkoo:problem:rate-limited', status: 429 });
  });

  it('counts requests with no Authorization header too', async () => {
    t = await buildTestApp();
    const { codes } = await flood(t.app, ROUTES[0], {}, 61);
    expect(codes[59]).toBe(401);
    expect(codes[60]).toBe(429);
  });

  it('limits a validly signed token of an erased install, without touching the database', async () => {
    t = await buildTestApp();
    const { body } = await registerInstall(t.app);
    const sub = hmacInstallId(body.install_id, t.config.serverPepper);
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = signTestJwt({ typ: 'install', sub, exp }, t.config.jwtSecret);
    await t.prisma.install.deleteMany();

    const lookups = vi.spyOn(t.prisma.install, 'findUnique');
    const { codes } = await flood(t.app, ROUTES[0], bearer(token), 70);
    expect(codes.filter((c) => c === 401)).toHaveLength(60);
    expect(codes.filter((c) => c === 429)).toHaveLength(10);
    // Only the 60 requests inside the limit reached authentication.
    expect(lookups).toHaveBeenCalledTimes(60);
  });

  it('keys by install, so two installs behind one IP do not share the per-install limit', async () => {
    t = await buildTestApp();
    const a = await registerInstall(t.app);
    const b = await registerInstall(t.app);
    const asA = await flood(t.app, ROUTES[0], bearer(a.token), 61);
    expect(asA.codes[60]).toBe(429);
    const asB = await flood(t.app, ROUTES[0], bearer(b.token), 1);
    expect(asB.codes).toEqual([200]);
  });

  it('keeps the global per-IP limit for install-scoped routes', async () => {
    t = await buildTestApp({ env: { RATE_LIMIT_MAX: '5' } });
    const { token } = await registerInstall(t.app);
    // The valid token stays far below 60/min per install, but the IP budget is 5.
    const { codes, last } = await flood(t.app, ROUTES[0], bearer(token), 7, '198.51.100.9');
    expect(codes).toEqual([200, 200, 200, 200, 200, 429, 429]);
    expect(last.json()).toMatchObject({ type: 'urn:poolamkoo:problem:rate-limited' });
    // Another IP is unaffected.
    expect((await flood(t.app, ROUTES[0], bearer(token), 1, '198.51.100.10')).codes).toEqual([200]);
  });

  it('shares one per-IP budget between public and install-scoped routes', async () => {
    t = await buildTestApp({ env: { RATE_LIMIT_MAX: '4' } });
    const ip = '198.51.100.30';
    const hit = (url: string) => t!.app.inject({ method: 'GET', url, remoteAddress: ip });
    expect((await hit('/v1/nope')).statusCode).toBe(404);
    expect((await hit('/v1/nope')).statusCode).toBe(404);
    expect((await hit('/v1/offers')).statusCode).toBe(401);
    expect((await hit('/v1/offers')).statusCode).toBe(401);
    expect((await hit('/v1/nope')).statusCode).toBe(429);
    expect((await hit('/v1/offers')).statusCode).toBe(429);
  });

  it('puts every IPv6 address of one /64 into the same bucket', async () => {
    t = await buildTestApp({ env: { RATE_LIMIT_MAX: '3' } });
    const hit = (remoteAddress: string) =>
      t!.app.inject({ method: 'GET', url: '/v1/nope', remoteAddress });
    expect((await hit('2001:db8:1:2::1')).statusCode).toBe(404);
    expect((await hit('2001:db8:1:2:aaaa::2')).statusCode).toBe(404);
    expect((await hit('2001:db8:1:2:bbbb::3')).statusCode).toBe(404);
    expect((await hit('2001:db8:1:2:cccc::4')).statusCode).toBe(429);
    expect((await hit('2001:db8:1:3::1')).statusCode).toBe(404);
  });

  it('answers 401 (not 400) for a bad token with an invalid body', async () => {
    t = await buildTestApp();
    const res = await t.app.inject({
      method: 'PUT',
      url: '/v1/installs/me/profile',
      headers: bearer('garbage'),
      payload: { nonsense: true },
    });
    expect(res.statusCode).toBe(401);
  });
});
