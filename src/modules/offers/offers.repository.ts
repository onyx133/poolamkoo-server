import type { PrismaClient } from '../../lib/prisma.js';
import type { IncomeBand } from '../profile/profile.schemas.js';

export interface OfferRecord {
  id: string;
  titleFa: string;
  bodyFa: string;
  ctaFa: string;
  url: string;
  expiresAt: Date;
}

export interface OffersRepository {
  /** The install's income band, or null when it has no profile. */
  findBand(idHash: string): Promise<IncomeBand | null>;
  /** Active offers with starts_at <= now < expires_at targeting `band`, soonest expiry first. */
  findActive(band: IncomeBand, now: Date, limit: number): Promise<OfferRecord[]>;
}

export class PrismaOffersRepository implements OffersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findBand(idHash: string): Promise<IncomeBand | null> {
    const row = await this.prisma.profile.findUnique({
      where: { installIdHash: idHash },
      select: { incomeBand: true },
    });
    return row?.incomeBand ?? null;
  }

  async findActive(band: IncomeBand, now: Date, limit: number): Promise<OfferRecord[]> {
    return this.prisma.offer.findMany({
      where: { active: true, startsAt: { lte: now }, expiresAt: { gt: now }, bands: { has: band } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        titleFa: true,
        bodyFa: true,
        ctaFa: true,
        url: true,
        expiresAt: true,
      },
    });
  }
}
