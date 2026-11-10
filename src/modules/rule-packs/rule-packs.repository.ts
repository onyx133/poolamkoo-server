import type { PrismaClient } from '../../lib/prisma.js';

export interface StoredRulePack {
  version: number;
  formatVersion: number;
  minAppVersion: number;
  /** The exact signed bytes. */
  payload: Buffer;
  /** base64 detached Ed25519 signature over `payload`. */
  signature: string;
}

export interface NewRulePack extends StoredRulePack {
  sha256: string;
}

export interface RulePacksRepository {
  /** Newest pack (highest version) with `min_app_version <= appVersion`. */
  latestFor(appVersion: number): Promise<StoredRulePack | null>;
  /**
   * Inserts `pack` only when its version is greater than every stored version. Check and
   * insert are one serialized step (advisory lock), so concurrent imports cannot store an
   * older version after a newer one.
   */
  insertIfNewer(pack: NewRulePack): Promise<InsertRulePackResult>;
}

export type InsertRulePackResult = { inserted: true } | { inserted: false; latest: number };

// Arbitrary constant for pg_advisory_xact_lock; one per importer (catalog uses 7_361_001).
const IMPORT_LOCK_KEY = 7_361_002;

export class PrismaRulePacksRepository implements RulePacksRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async latestFor(appVersion: number): Promise<StoredRulePack | null> {
    const row = await this.prisma.rulePack.findFirst({
      where: { minAppVersion: { lte: appVersion } },
      orderBy: { version: 'desc' },
    });
    return row
      ? {
          version: row.version,
          formatVersion: row.formatVersion,
          minAppVersion: row.minAppVersion,
          payload: Buffer.from(row.payload),
          signature: row.signature,
        }
      : null;
  }

  async insertIfNewer(pack: NewRulePack): Promise<InsertRulePackResult> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IMPORT_LOCK_KEY})`;
      const latest = await tx.rulePack.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if (latest && pack.version <= latest.version) {
        return { inserted: false, latest: latest.version };
      }
      await tx.rulePack.create({
        data: {
          version: pack.version,
          formatVersion: pack.formatVersion,
          minAppVersion: pack.minAppVersion,
          payload: new Uint8Array(pack.payload),
          signature: pack.signature,
          sha256: pack.sha256,
        },
      });
      return { inserted: true };
    });
  }
}
