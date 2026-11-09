import { z } from 'zod';

export const INCOME_BANDS = ['B1', 'B2', 'B3', 'B4', 'B5'] as const;
export type IncomeBand = (typeof INCOME_BANDS)[number];

export const putProfileBody = z.strictObject({
  income_band: z.enum(INCOME_BANDS),
  // Jalali year-month, e.g. 1405-08
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'must look like 1405-08'),
  consent_version: z.number().int().min(1),
});
export type PutProfileBody = z.infer<typeof putProfileBody>;

export const bandTableResponse = z.object({
  version: z.number().int(),
  currency: z.string(),
  bands: z.array(
    z.object({
      key: z.enum(INCOME_BANDS),
      max_monthly_net_income: z.number().nullable(),
    }),
  ),
});
export type BandTable = z.infer<typeof bandTableResponse>;
