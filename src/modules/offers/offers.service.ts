import type { OffersRepository } from './offers.repository.js';
import type { OffersResponse } from './offers.schemas.js';

export const MAX_OFFERS = 20;

export interface OffersServiceDeps {
  repo: OffersRepository;
  now?: () => Date;
}

// Same format as token expiry: no milliseconds.
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export class OffersService {
  private readonly repo: OffersRepository;
  private readonly now: () => Date;

  constructor(deps: OffersServiceDeps) {
    this.repo = deps.repo;
    this.now = deps.now ?? (() => new Date());
  }

  /** Offers for the install's band; empty without a profile. */
  async listFor(idHash: string): Promise<OffersResponse> {
    const band = await this.repo.findBand(idHash);
    if (band === null) return { offers: [] };
    const rows = await this.repo.findActive(band, this.now(), MAX_OFFERS);
    return {
      offers: rows.map((o) => ({
        id: o.id,
        title_fa: o.titleFa,
        body_fa: o.bodyFa,
        cta_fa: o.ctaFa,
        url: o.url,
        expires_at: iso(o.expiresAt),
      })),
    };
  }
}
