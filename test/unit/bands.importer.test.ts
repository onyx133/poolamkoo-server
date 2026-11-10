import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BandsImportError,
  importBands,
  parseBandsFile,
  type BandsImportRepository,
  type InsertBandTableResult,
} from '../../src/modules/profile/bands.importer.js';
import type { BandTable } from '../../src/modules/profile/profile.schemas.js';

const valid = (): BandTable => ({
  version: 2,
  currency: 'IRR',
  bands: [
    { key: 'B1', max_monthly_net_income: 100 },
    { key: 'B2', max_monthly_net_income: 200 },
    { key: 'B3', max_monthly_net_income: 300 },
    { key: 'B4', max_monthly_net_income: 400 },
    { key: 'B5', max_monthly_net_income: null },
  ],
});

class FakeRepo implements BandsImportRepository {
  rows: BandTable[] = [];
  insertBandTableIfNewer(table: BandTable): Promise<InsertBandTableResult> {
    const latest = Math.max(0, ...this.rows.map((r) => r.version));
    if (this.rows.length > 0 && table.version <= latest) {
      return Promise.resolve({ inserted: false, latest });
    }
    this.rows.push(table);
    return Promise.resolve({ inserted: true });
  }
}

describe('parseBandsFile', () => {
  it('accepts the shipped seed/bands.json', () => {
    const raw = JSON.parse(readFileSync('seed/bands.json', 'utf8')) as unknown;
    expect(parseBandsFile(raw).bands).toHaveLength(5);
  });

  it.each([
    ['version 0', (f: BandTable) => ({ ...f, version: 0 })],
    ['version beyond int32', (f: BandTable) => ({ ...f, version: 2_147_483_648 })],
    ['wrong currency', (f: BandTable) => ({ ...f, currency: 'USD' })],
    ['no bands', (f: BandTable) => ({ ...f, bands: [] })],
    [
      'unknown band key',
      (f: BandTable) => ({ ...f, bands: [{ key: 'B9', max_monthly_net_income: null }] }),
    ],
    [
      'fractional limit',
      (f: BandTable) => ({ ...f, bands: [{ key: 'B1', max_monthly_net_income: 1.5 }] }),
    ],
    [
      'null that is not the last band',
      (f: BandTable) => ({
        ...f,
        bands: [{ ...f.bands[0]!, max_monthly_net_income: null }, ...f.bands.slice(1)],
      }),
    ],
    [
      'last band bounded',
      (f: BandTable) => ({
        ...f,
        bands: f.bands.map((b) => ({
          ...b,
          max_monthly_net_income: b.max_monthly_net_income ?? 999,
        })),
      }),
    ],
    [
      'not ascending',
      (f: BandTable) => ({
        ...f,
        bands: f.bands.map((b) => (b.key === 'B2' ? { ...b, max_monthly_net_income: 100 } : b)),
      }),
    ],
    [
      'duplicate keys',
      (f: BandTable) => ({
        ...f,
        bands: [f.bands[0]!, f.bands[0]!, { key: 'B5' as const, max_monthly_net_income: null }].map(
          (b, i) => (i === 1 ? { ...b, max_monthly_net_income: 150 } : b),
        ),
      }),
    ],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseBandsFile(mutate(valid()))).toThrow(BandsImportError);
  });

  it('rejects unrelated JSON', () => {
    expect(() => parseBandsFile('nope')).toThrow(/Invalid bands file/);
  });
});

describe('importBands', () => {
  it('stores a newer version', async () => {
    const repo = new FakeRepo();
    expect((await importBands(repo, valid())).version).toBe(2);
    expect(repo.rows).toHaveLength(1);
  });

  it('refuses a version that is not greater than the latest', async () => {
    const repo = new FakeRepo();
    await importBands(repo, valid());
    await expect(importBands(repo, valid())).rejects.toThrow(
      /greater than the latest stored version \(2\)/,
    );
    await expect(importBands(repo, { ...valid(), version: 1 })).rejects.toThrow(/greater than/);
    expect(repo.rows).toHaveLength(1);
  });

  it('validates before touching the repository', async () => {
    const repo = new FakeRepo();
    await expect(importBands(repo, { version: 0 })).rejects.toThrow(BandsImportError);
    expect(repo.rows).toHaveLength(0);
  });
});
