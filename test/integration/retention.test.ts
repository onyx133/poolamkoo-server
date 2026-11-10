import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { run as pruneCli } from '../../src/cli/installs-prune.js';
import { PrismaInstallsRepository } from '../../src/modules/installs/installs.repository.js';
import { InstallsService } from '../../src/modules/installs/installs.service.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';

const NOW = new Date('2026-11-10T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const hash = (c: string) => c.repeat(64);

describe('install retention', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await resetDb(t.prisma);
    for (const [c, age] of [
      ['a', 400],
      ['b', 181],
      ['c', 180],
      ['d', 1],
    ] as const) {
      await t.prisma.install.create({
        data: {
          idHash: hash(c),
          platform: 'android',
          appVersion: '0.1.0',
          store: 'bazaar',
          lastSeenOn: daysAgo(age),
        },
      });
      await t.prisma.profile.create({
        data: { installIdHash: hash(c), incomeBand: 'B2', period: '1405-08', consentVersion: 1 },
      });
    }
  });

  const remaining = async () =>
    (await t.prisma.install.findMany({ orderBy: { idHash: 'asc' } })).map((i) => i.idHash[0]);

  it('deletes installs not seen for more than N days; profiles cascade', async () => {
    const service = new InstallsService({
      repo: new PrismaInstallsRepository(t.prisma),
      pepper: t.config.serverPepper,
      now: () => NOW,
    });
    expect(await service.pruneInactive(180)).toBe(2);
    expect(await remaining()).toEqual(['c', 'd']);
    expect((await t.prisma.profile.findMany()).map((p) => p.installIdHash[0]).sort()).toEqual([
      'c',
      'd',
    ]);
    expect(await service.pruneInactive(180)).toBe(0);
  });

  describe('installs:prune CLI', () => {
    const env = () => ({ DATABASE_URL: inject('testDatabaseUrl') });
    // The CLI uses the real clock; the fixtures above are relative to a fixed NOW, so shift
    // them to "today" first.
    const shiftToToday = async () => {
      const offsetMs = Date.now() - NOW.getTime();
      for (const i of await t.prisma.install.findMany()) {
        await t.prisma.install.update({
          where: { idHash: i.idHash },
          data: { lastSeenOn: new Date(i.lastSeenOn.getTime() + offsetMs) },
        });
      }
    };

    it('honours --days and needs only DATABASE_URL', async () => {
      await shiftToToday();
      expect(await pruneCli(['--days', '30'], env())).toBe(2 + 1); // 400, 181 and 180 days old
      expect(await remaining()).toEqual(['d']);
    });

    it('defaults to INSTALL_RETENTION_DAYS', async () => {
      await shiftToToday();
      expect(await pruneCli([], { ...env(), INSTALL_RETENTION_DAYS: '300' })).toBe(1);
      expect(await remaining()).toEqual(['b', 'c', 'd']);
    });

    it('rejects a missing database URL and bad --days', async () => {
      await expect(pruneCli(['--days', '30'], {})).rejects.toThrow(/DATABASE_URL/);
      await expect(pruneCli(['--days', '0'], env())).rejects.toThrow(/--days/);
      await expect(pruneCli(['--days', 'abc'], env())).rejects.toThrow(/--days/);
      expect(await remaining()).toEqual(['a', 'b', 'c', 'd']);
    });
  });
});
