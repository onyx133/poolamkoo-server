import { describe, expect, it } from 'vitest';
import type { OfferRecord, OffersRepository } from '../../src/modules/offers/offers.repository.js';
import { MAX_OFFERS, OffersService } from '../../src/modules/offers/offers.service.js';
import type { IncomeBand } from '../../src/modules/profile/profile.schemas.js';

class FakeOffersRepository implements OffersRepository {
  bands = new Map<string, IncomeBand>();
  offers: OfferRecord[] = [];
  calls: { band: IncomeBand; now: Date; limit: number }[] = [];

  findBand(idHash: string): Promise<IncomeBand | null> {
    return Promise.resolve(this.bands.get(idHash) ?? null);
  }
  findActive(band: IncomeBand, now: Date, limit: number): Promise<OfferRecord[]> {
    this.calls.push({ band, now, limit });
    return Promise.resolve(this.offers);
  }
}

const id = 'b'.repeat(64);
const now = new Date('2026-11-10T10:00:00.000Z');

describe('OffersService.listFor', () => {
  it('returns no offers (and does not query offers) without a profile', async () => {
    const repo = new FakeOffersRepository();
    const service = new OffersService({ repo, now: () => now });
    expect(await service.listFor(id)).toEqual({ offers: [] });
    expect(repo.calls).toHaveLength(0);
  });

  it('queries with the profile band, the clock and the cap, and maps fields', async () => {
    const repo = new FakeOffersRepository();
    repo.bands.set(id, 'B3');
    repo.offers = [
      {
        id: 'o_1',
        titleFa: 't',
        bodyFa: 'b',
        ctaFa: 'c',
        url: 'https://example.com/x',
        expiresAt: new Date('2026-12-01T05:30:00.123Z'),
      },
    ];
    const service = new OffersService({ repo, now: () => now });
    expect(await service.listFor(id)).toEqual({
      offers: [
        {
          id: 'o_1',
          title_fa: 't',
          body_fa: 'b',
          cta_fa: 'c',
          url: 'https://example.com/x',
          expires_at: '2026-12-01T05:30:00Z',
        },
      ],
    });
    expect(repo.calls).toEqual([{ band: 'B3', now, limit: MAX_OFFERS }]);
    expect(MAX_OFFERS).toBe(20);
  });
});
