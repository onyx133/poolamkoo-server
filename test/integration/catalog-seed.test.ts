import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCatalog } from '../../prisma/seed-catalog.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';

describe('prisma seed hook: seedCatalog', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await buildTestApp();
  });
  afterAll(() => t.close());
  beforeEach(() => resetDb(t.prisma));

  it('imports the placeholder seed once and leaves an existing catalog alone', async () => {
    await seedCatalog(t.prisma);
    expect(await t.prisma.catalogRelease.count()).toBe(1);
    const merchants = await t.prisma.merchant.count();
    expect(merchants).toBeGreaterThan(20);

    await t.prisma.merchant.deleteMany({ where: { key: 'snappfood' } });
    await seedCatalog(t.prisma);
    expect(await t.prisma.catalogRelease.count()).toBe(1);
    expect(await t.prisma.merchant.count()).toBe(merchants - 1);

    const res = await t.app.inject({ method: 'GET', url: '/v1/catalog' });
    expect(res.statusCode).toBe(200);
  });
});
