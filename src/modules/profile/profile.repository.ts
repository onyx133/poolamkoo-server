import type { PrismaClient } from '../../lib/prisma.js';
import { bandTableResponse, type BandTable, type PutProfileBody } from './profile.schemas.js';

export interface ProfileRepository {
  /** Insert or overwrite: only the latest value is kept. */
  upsert(idHash: string, profile: PutProfileBody): Promise<void>;
  /** Idempotent. */
  delete(idHash: string): Promise<void>;
  /** The band table with the highest version, or null when none was seeded. */
  latestBandTable(): Promise<BandTable | null>;
}

export class PrismaProfileRepository implements ProfileRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(idHash: string, profile: PutProfileBody): Promise<void> {
    const data = {
      incomeBand: profile.income_band,
      period: profile.period,
      consentVersion: profile.consent_version,
    };
    await this.prisma.profile.upsert({
      where: { installIdHash: idHash },
      create: { installIdHash: idHash, ...data },
      update: data,
    });
  }

  async delete(idHash: string): Promise<void> {
    await this.prisma.profile.deleteMany({ where: { installIdHash: idHash } });
  }

  async latestBandTable(): Promise<BandTable | null> {
    const row = await this.prisma.bandTable.findFirst({ orderBy: { version: 'desc' } });
    if (!row) return null;
    return bandTableResponse.parse({
      version: row.version,
      currency: row.currency,
      bands: row.bands,
    });
  }
}
