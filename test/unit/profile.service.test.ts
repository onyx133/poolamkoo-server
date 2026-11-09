import { describe, expect, it } from 'vitest';
import type { ProfileRepository } from '../../src/modules/profile/profile.repository.js';
import type { BandTable, PutProfileBody } from '../../src/modules/profile/profile.schemas.js';
import { bandsEtag, ProfileService } from '../../src/modules/profile/profile.service.js';

class FakeProfileRepository implements ProfileRepository {
  rows = new Map<string, PutProfileBody>();
  table: BandTable | null = null;

  upsert(idHash: string, profile: PutProfileBody): Promise<void> {
    this.rows.set(idHash, profile);
    return Promise.resolve();
  }
  delete(idHash: string): Promise<void> {
    this.rows.delete(idHash);
    return Promise.resolve();
  }
  latestBandTable(): Promise<BandTable | null> {
    return Promise.resolve(this.table);
  }
}

const id = 'a'.repeat(64);

describe('ProfileService', () => {
  it('keeps only the latest profile per install', async () => {
    const repo = new FakeProfileRepository();
    const service = new ProfileService(repo);
    await service.put(id, { income_band: 'B1', period: '1405-07', consent_version: 1 });
    await service.put(id, { income_band: 'B4', period: '1405-08', consent_version: 2 });
    expect(repo.rows.size).toBe(1);
    expect(repo.rows.get(id)).toEqual({
      income_band: 'B4',
      period: '1405-08',
      consent_version: 2,
    });
  });

  it('removes idempotently', async () => {
    const repo = new FakeProfileRepository();
    const service = new ProfileService(repo);
    await service.put(id, { income_band: 'B2', period: '1405-08', consent_version: 1 });
    await service.remove(id);
    await expect(service.remove(id)).resolves.toBeUndefined();
    expect(repo.rows.size).toBe(0);
  });

  it('returns the band table, or null when there is none', async () => {
    const repo = new FakeProfileRepository();
    const service = new ProfileService(repo);
    expect(await service.bands()).toBeNull();
    repo.table = {
      version: 2,
      currency: 'IRR',
      bands: [{ key: 'B1', max_monthly_net_income: null }],
    };
    expect(await service.bands()).toBe(repo.table);
  });

  it('formats the bands ETag', () => {
    expect(bandsEtag(7)).toBe('"bands-7"');
  });
});
