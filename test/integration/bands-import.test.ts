import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { run as importCli } from '../../src/cli/bands-import.js';
import { buildTestApp, type TestApp } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';

const bandsJson = (version: number) =>
  JSON.stringify({
    version,
    currency: 'IRR',
    bands: [
      { key: 'B1', max_monthly_net_income: 100 },
      { key: 'B2', max_monthly_net_income: 200 },
      { key: 'B3', max_monthly_net_income: 300 },
      { key: 'B4', max_monthly_net_income: 400 },
      { key: 'B5', max_monthly_net_income: null },
    ],
  });

describe('bands:import', () => {
  let t: TestApp;
  let dir: string;
  beforeAll(async () => {
    t = await buildTestApp();
    dir = mkdtempSync(join(tmpdir(), 'poolamkoo-bands-'));
  });
  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    await t.close();
  });
  beforeEach(() => resetDb(t.prisma));

  const env = () => ({ DATABASE_URL: inject('testDatabaseUrl') });
  const file = (content: string) => {
    const path = join(dir, 'bands.json');
    writeFileSync(path, content);
    return path;
  };
  const get = () => t.app.inject({ method: 'GET', url: '/v1/profile/bands' });

  it('publishes a new version that GET /v1/profile/bands then serves', async () => {
    expect((await get()).statusCode).toBe(404);
    await importCli([file(bandsJson(1))], env());
    expect((await get()).headers['etag']).toBe('"bands-1"');
    await importCli([file(bandsJson(2))], env());
    const res = await get();
    expect(res.headers['etag']).toBe('"bands-2"');
    expect(res.json()).toMatchObject({ version: 2, currency: 'IRR' });
    expect(await t.prisma.bandTable.count()).toBe(2);
  });

  it('refuses a version that is not greater than the current one', async () => {
    await importCli([file(bandsJson(3))], env());
    await expect(importCli([file(bandsJson(3))], env())).rejects.toThrow(/greater than/);
    await expect(importCli([file(bandsJson(2))], env())).rejects.toThrow(/greater than/);
    expect(await t.prisma.bandTable.count()).toBe(1);
  });

  it('refuses invalid files and bad usage without writing', async () => {
    await expect(importCli([file('{nope')], env())).rejects.toThrow(/Cannot read/);
    await expect(importCli([file('{"version":1}')], env())).rejects.toThrow(/Invalid bands file/);
    await expect(importCli([], env())).rejects.toThrow(/Usage/);
    await expect(importCli([file(bandsJson(1))], {})).rejects.toThrow(/DATABASE_URL/);
    expect(await t.prisma.bandTable.count()).toBe(0);
  });

  it('serializes concurrent imports of the same version', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () => importCli([file(bandsJson(7))], env())),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await t.prisma.bandTable.count()).toBe(1);
  });
});
