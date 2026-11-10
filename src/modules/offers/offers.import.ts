import { z } from 'zod';
import { INCOME_BANDS } from '../profile/profile.schemas.js';
import type { OffersImportRepository } from './offers.repository.js';

const text = z.string().trim().min(1);

const offerEntry = z
  .strictObject({
    id: z
      .string()
      .max(64)
      .regex(/^[A-Za-z0-9_-]+$/, 'may only contain letters, digits, _ and -'),
    title_fa: text,
    body_fa: text,
    cta_fa: text,
    url: z
      .url()
      .max(2048)
      .refine((u) => u.startsWith('https://'), 'must be an https:// URL'),
    bands: z
      .array(z.enum(INCOME_BANDS))
      .min(1)
      .refine((b) => new Set(b).size === b.length, 'must not repeat a band'),
    starts_at: z.iso.datetime({ offset: true }),
    expires_at: z.iso.datetime({ offset: true }),
    active: z.boolean().default(true),
  })
  .refine((o) => Date.parse(o.expires_at) > Date.parse(o.starts_at), {
    path: ['expires_at'],
    message: 'must be after starts_at',
  });

export const offersFile = z
  .strictObject({ offers: z.array(offerEntry) })
  .refine((f) => new Set(f.offers.map((o) => o.id)).size === f.offers.length, {
    path: ['offers'],
    message: 'offer ids must be unique',
  });
export type OffersFile = z.infer<typeof offersFile>;

export class OffersFileError extends Error {}

/** Parses and validates the import file's text; throws OffersFileError with a readable message. */
export function parseOffersFile(raw: string): OffersFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new OffersFileError('File is not valid JSON');
  }
  const parsed = offersFile.safeParse(json);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    throw new OffersFileError(`Invalid offers file:\n${lines.join('\n')}`);
  }
  return parsed.data;
}

/** Replaces the whole offer set atomically. Returns how many offers are stored afterwards. */
export async function replaceOffers(
  repo: OffersImportRepository,
  file: OffersFile,
): Promise<number> {
  await repo.replaceAll(
    file.offers.map((o) => ({
      id: o.id,
      titleFa: o.title_fa,
      bodyFa: o.body_fa,
      ctaFa: o.cta_fa,
      url: o.url,
      bands: o.bands,
      startsAt: new Date(o.starts_at),
      expiresAt: new Date(o.expires_at),
      active: o.active,
    })),
  );
  return file.offers.length;
}
