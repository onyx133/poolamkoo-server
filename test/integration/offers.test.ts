import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { IncomeBand } from '../../src/generated/prisma/client.js';
import { parseOffersFile, replaceOffers } from '../../src/modules/offers/offers.import.js';
import { PrismaOffersRepository } from '../../src/modules/offers/offers.repository.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';
import { bearer, registerInstall } from '../helpers/fixtures.js';

const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs);

describe('offers', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetDb(t.prisma));

  let seq = 0;
  const createOffer = (
    overrides: Partial<{
      id: string;
      bands: IncomeBand[];
      startsAt: Date;
      expiresAt: Date;
      active: boolean;
    }> = {},
  ) => {
    const id = overrides.id ?? `o_${++seq}`;
    return t.prisma.offer.create({
      data: {
        id,
        titleFa: `عنوان ${id}`,
        bodyFa: `متن ${id}`,
        ctaFa: 'مشاهده',
        url: `https://example.com/${id}`,
        bands: ['B1', 'B2', 'B3', 'B4', 'B5'],
        startsAt: at(-HOUR),
        expiresAt: at(HOUR),
        ...overrides,
      },
    });
  };

  const setBand = (token: string, band: IncomeBand) =>
    t.app.inject({
      method: 'PUT',
      url: '/v1/installs/me/profile',
      headers: bearer(token),
      payload: { income_band: band, period: '1405-08', consent_version: 1 },
    });
  const getOffers = (headers: Record<string, string>) =>
    t.app.inject({ method: 'GET', url: '/v1/offers', headers });
  const idsOf = (res: Awaited<ReturnType<typeof getOffers>>) =>
    res.json<{ offers: { id: string }[] }>().offers.map((o) => o.id);

  describe('GET /v1/offers', () => {
    it('requires auth', async () => {
      for (const headers of [{}, bearer('garbage')]) {
        const res = await getOffers(headers);
        expect(res.statusCode).toBe(401);
        expect(res.headers['content-type']).toContain('application/problem+json');
      }
    });

    it('returns an empty list without a profile, uncached', async () => {
      await createOffer();
      const { token } = await registerInstall(t.app);
      const res = await getOffers(bearer(token));
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.json()).toEqual({ offers: [] });
    });

    it('returns the contract shape for a matching offer', async () => {
      const expiresAt = new Date('2099-01-01T12:34:56.789Z');
      await createOffer({ id: 'o_shape', expiresAt });
      const { token } = await registerInstall(t.app);
      await setBand(token, 'B3');
      const res = await getOffers(bearer(token));
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('private, no-store');
      expect(res.json()).toEqual({
        offers: [
          {
            id: 'o_shape',
            title_fa: 'عنوان o_shape',
            body_fa: 'متن o_shape',
            cta_fa: 'مشاهده',
            url: 'https://example.com/o_shape',
            expires_at: '2099-01-01T12:34:56Z',
          },
        ],
      });
    });

    it('filters by the install band and follows profile changes', async () => {
      await createOffer({ id: 'low', bands: ['B1', 'B2'] });
      await createOffer({ id: 'high', bands: ['B4', 'B5'] });
      await createOffer({ id: 'all' });
      const { token } = await registerInstall(t.app);

      await setBand(token, 'B1');
      expect(idsOf(await getOffers(bearer(token))).sort()).toEqual(['all', 'low']);
      await setBand(token, 'B5');
      expect(idsOf(await getOffers(bearer(token))).sort()).toEqual(['all', 'high']);
      await setBand(token, 'B3');
      expect(idsOf(await getOffers(bearer(token)))).toEqual(['all']);

      await t.app.inject({
        method: 'DELETE',
        url: '/v1/installs/me/profile',
        headers: bearer(token),
      });
      expect(idsOf(await getOffers(bearer(token)))).toEqual([]);
    });

    it('excludes expired, inactive and not-yet-started offers', async () => {
      await createOffer({ id: 'ok' });
      await createOffer({ id: 'expired', expiresAt: at(-1000) });
      await createOffer({ id: 'inactive', active: false });
      await createOffer({ id: 'future', startsAt: at(HOUR), expiresAt: at(2 * HOUR) });
      const { token } = await registerInstall(t.app);
      await setBand(token, 'B2');
      expect(idsOf(await getOffers(bearer(token)))).toEqual(['ok']);
    });

    it('sorts by expires_at ascending and caps at 20', async () => {
      for (let i = 0; i < 25; i++) {
        // Created in reverse expiry order
        await createOffer({
          id: `o_${String(i).padStart(2, '0')}`,
          expiresAt: at((30 - i) * HOUR),
        });
      }
      const { token } = await registerInstall(t.app);
      await setBand(token, 'B1');
      const ids = idsOf(await getOffers(bearer(token)));
      expect(ids).toHaveLength(20);
      expect(ids[0]).toBe('o_24');
      expect(ids[19]).toBe('o_05');
    });
  });

  describe('import', () => {
    const offer = (overrides: Record<string, unknown> = {}) => ({
      id: 'o_new',
      title_fa: 'عنوان',
      body_fa: 'متن',
      cta_fa: 'برو',
      url: 'https://example.com/new',
      bands: ['B1'],
      starts_at: '2026-01-01T00:00:00Z',
      expires_at: '2099-01-01T00:00:00Z',
      ...overrides,
    });

    it('replaces the whole offer set', async () => {
      await createOffer({ id: 'old_1' });
      await createOffer({ id: 'old_2' });
      const file = parseOffersFile(
        JSON.stringify({
          offers: [
            offer({ id: 'new_1' }),
            offer({ id: 'new_2', active: false, bands: ['B2', 'B3'] }),
          ],
        }),
      );
      expect(await replaceOffers(new PrismaOffersRepository(t.prisma), file)).toBe(2);

      const rows = await t.prisma.offer.findMany({ orderBy: { id: 'asc' } });
      expect(rows.map((r) => r.id)).toEqual(['new_1', 'new_2']);
      expect(rows[0]).toMatchObject({
        active: true,
        bands: ['B1'],
        url: 'https://example.com/new',
      });
      expect(rows[1]).toMatchObject({ active: false, bands: ['B2', 'B3'] });
      expect(rows[0]!.expiresAt.toISOString()).toBe('2099-01-01T00:00:00.000Z');
    });

    it('leaves the old set untouched when the new set fails to insert', async () => {
      await createOffer({ id: 'keep' });
      // Bypass file validation to force a database error (http:// violates the CHECK).
      const bad = { offers: [{ ...offer(), url: 'http://example.com/x', active: true }] };
      await expect(
        replaceOffers(new PrismaOffersRepository(t.prisma), bad as never),
      ).rejects.toThrow();
      expect((await t.prisma.offer.findMany()).map((r) => r.id)).toEqual(['keep']);
    });

    describe('CLI', () => {
      let dir: string;
      beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'poolamkoo-offers-'));
      });
      afterAll(() => rmSync(dir, { recursive: true, force: true }));

      const runCli = (content: string | null) => {
        const file = join(dir, 'offers.json');
        if (content !== null) writeFileSync(file, content);
        const arg = content === null ? join(dir, 'missing.json') : file;
        return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/offers-import.ts', arg], {
          cwd: process.cwd(),
          encoding: 'utf8',
          // Only the database URL: the CLI must not need the pepper or the JWT secret.
          env: { ...process.env, DATABASE_URL: inject('testDatabaseUrl') },
        });
      };

      it('imports a valid file and prints a summary', async () => {
        await createOffer({ id: 'old' });
        const res = runCli(JSON.stringify({ offers: [offer()] }));
        expect(res.status).toBe(0);
        expect(res.stdout).toContain('1 offer');
        expect((await t.prisma.offer.findMany()).map((r) => r.id)).toEqual(['o_new']);
      });

      it('rejects http:// URLs with a clear message and changes nothing', async () => {
        await createOffer({ id: 'old' });
        const res = runCli(JSON.stringify({ offers: [offer({ url: 'http://example.com/x' })] }));
        expect(res.status).not.toBe(0);
        expect(res.stderr).toContain('offers.0.url');
        expect(res.stderr).toContain('https');
        expect((await t.prisma.offer.findMany()).map((r) => r.id)).toEqual(['old']);
      });

      it('fails on invalid JSON and on a missing file', async () => {
        const badJson = runCli('{nope');
        expect(badJson.status).not.toBe(0);
        expect(badJson.stderr).toContain('not valid JSON');
        const missing = runCli(null);
        expect(missing.status).not.toBe(0);
        expect(missing.stderr).toContain('Cannot read file');
      });
    });
  });
});
