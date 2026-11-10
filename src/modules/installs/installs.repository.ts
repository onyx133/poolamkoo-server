import type { PrismaClient } from '../../lib/prisma.js';
import type { Store } from './installs.schemas.js';

export interface UpsertInstall {
  idHash: string;
  platform: 'android';
  appVersion: string;
  store: Store;
  /** UTC day, YYYY-MM-DD */
  lastSeenOn: string;
}

export interface InstallsRepository {
  /** Insert or refresh; resolves to true when a new row was created. */
  upsert(input: UpsertInstall): Promise<boolean>;
  /** The install's last_seen_on (YYYY-MM-DD), or null when the install does not exist. */
  findLastSeenOn(idHash: string): Promise<string | null>;
  touchLastSeenOn(idHash: string, day: string): Promise<void>;
  /** Idempotent. Related rows (profile) go with it via ON DELETE CASCADE. */
  delete(idHash: string): Promise<void>;
  /** Deletes installs whose last_seen_on is before `day` (YYYY-MM-DD); returns how many. */
  deleteLastSeenBefore(day: string): Promise<number>;
}

export class PrismaInstallsRepository implements InstallsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(input: UpsertInstall): Promise<boolean> {
    // One atomic statement; `xmax = 0` is true only for freshly inserted rows.
    const rows = await this.prisma.$queryRaw<{ inserted: boolean }[]>`
      INSERT INTO installs (id_hash, platform, app_version, store, last_seen_on)
      VALUES (${input.idHash}, ${input.platform}, ${input.appVersion},
              ${input.store}::store, ${input.lastSeenOn}::date)
      ON CONFLICT (id_hash) DO UPDATE
        SET app_version = EXCLUDED.app_version,
            store = EXCLUDED.store,
            last_seen_on = EXCLUDED.last_seen_on
      RETURNING (xmax = 0) AS inserted`;
    return rows[0]?.inserted ?? false;
  }

  async findLastSeenOn(idHash: string): Promise<string | null> {
    const row = await this.prisma.install.findUnique({
      where: { idHash },
      select: { lastSeenOn: true },
    });
    return row ? row.lastSeenOn.toISOString().slice(0, 10) : null;
  }

  async touchLastSeenOn(idHash: string, day: string): Promise<void> {
    await this.prisma.install.updateMany({
      where: { idHash },
      data: { lastSeenOn: new Date(`${day}T00:00:00Z`) },
    });
  }

  async delete(idHash: string): Promise<void> {
    await this.prisma.install.deleteMany({ where: { idHash } });
  }

  async deleteLastSeenBefore(day: string): Promise<number> {
    // Profiles go with them (ON DELETE CASCADE).
    const { count } = await this.prisma.install.deleteMany({
      where: { lastSeenOn: { lt: new Date(day + 'T00:00:00Z') } },
    });
    return count;
  }
}
