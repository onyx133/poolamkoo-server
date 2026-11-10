import { z } from 'zod';
import { INCOME_BANDS, type BandTable } from './profile.schemas.js';

export class BandsImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BandsImportError';
  }
}

const INT32_MAX = 2_147_483_647;

export const bandsFileSchema = z.object({
  version: z.number().int().min(1).max(INT32_MAX),
  currency: z.literal('IRR'),
  bands: z
    .array(
      z.object({
        key: z.enum(INCOME_BANDS),
        max_monthly_net_income: z.number().int().positive().nullable(),
      }),
    )
    .min(1),
});

/** Shape check plus the ordering rules; throws BandsImportError with the first problem found. */
export function parseBandsFile(raw: unknown): BandTable {
  const parsed = bandsFileSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new BandsImportError(`Invalid bands file:\n${lines.map((l) => `  - ${l}`).join('\n')}`);
  }
  const file = parsed.data;

  // Ascending, and only the last band may be unbounded.
  file.bands.forEach((band, i) => {
    const next = file.bands[i + 1];
    const last = i === file.bands.length - 1;
    if ((band.max_monthly_net_income === null) !== last) {
      throw new BandsImportError(`bands file: only the last band may be null (band ${band.key})`);
    }
    if (next && band.max_monthly_net_income !== null && next.max_monthly_net_income !== null) {
      if (next.max_monthly_net_income <= band.max_monthly_net_income) {
        throw new BandsImportError(
          `bands file: bands must be ascending (${band.key} -> ${next.key})`,
        );
      }
    }
  });
  const keys = file.bands.map((b) => b.key);
  if (new Set(keys).size !== keys.length) {
    throw new BandsImportError('bands file: band keys must be unique');
  }
  return file;
}

export type InsertBandTableResult = { inserted: true } | { inserted: false; latest: number };

export interface BandsImportRepository {
  /**
   * Inserts `table` only when its version is greater than every stored version. The check
   * and the insert are one serialized step (advisory lock), so concurrent imports cannot
   * publish an older version after a newer one.
   */
  insertBandTableIfNewer(table: BandTable): Promise<InsertBandTableResult>;
}

/** Validates the file and stores it as a new `band_tables` version (must be the newest). */
export async function importBands(repo: BandsImportRepository, raw: unknown): Promise<BandTable> {
  const table = parseBandsFile(raw);
  const result = await repo.insertBandTableIfNewer(table);
  if (!result.inserted) {
    throw new BandsImportError(
      `version ${table.version} must be greater than the latest stored version (${result.latest})`,
    );
  }
  return table;
}
