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
  /** Highest stored version overall, or null. */
  latestVersion(): Promise<number | null>;
  insert(pack: NewRulePack): Promise<void>;
}

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

  async latestVersion(): Promise<number | null> {
    const row = await this.prisma.rulePack.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return row?.version ?? null;
  }

  async insert(pack: NewRulePack): Promise<void> {
    await this.prisma.rulePack.create({
      data: {
        version: pack.version,
        formatVersion: pack.formatVersion,
        minAppVersion: pack.minAppVersion,
        payload: new Uint8Array(pack.payload),
        signature: pack.signature,
        sha256: pack.sha256,
      },
    });
  }
}
