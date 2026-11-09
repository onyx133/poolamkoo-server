import { z } from 'zod';

// The exact shape of the `GET /v1/catalog` body (docs/api/contract-v1.md). The importer
// validates the seed file against it and the route documents its response with it.

const KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
// Characters that can occur in SVG path data.
const PATH_DATA_PATTERN = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,+\-\s]+$/;

export const MAX_PATH_LENGTH = 4096;
export const MAX_LAYERS = 8;
export const MAX_KEYWORDS = 40;

const key = z
  .string()
  .max(64)
  .regex(KEY_PATTERN, 'must be lowercase dot/underscore separated, e.g. food.delivery');

const name = z.string().trim().min(1).max(80);

export const categoryKind = z.enum(['expense', 'income', 'neutral']);
export const iconRole = z.enum(['plate', 'glyph', 'accent']);

export const catalogCategorySchema = z.strictObject({
  key,
  parent_key: key.nullable(),
  kind: categoryKind,
  name_fa: name,
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be #RRGGBB'),
  icon_key: key,
  sort: z.number().int().min(0).max(1_000_000),
});

export const catalogMerchantSchema = z.strictObject({
  key,
  name_fa: name,
  category_key: key,
  icon_key: key,
  keywords: z.array(z.string().trim().min(1).max(64)).max(MAX_KEYWORDS),
});

export const catalogIconLayerSchema = z.strictObject({
  role: iconRole,
  d: z
    .string()
    .min(1)
    .max(MAX_PATH_LENGTH)
    .regex(PATH_DATA_PATTERN, 'must be SVG path data')
    .refine((d) => d.trim().length > 0, 'must not be blank'),
});

export const catalogIconSchema = z.strictObject({
  key,
  view_box: z.tuple([z.number().int().positive().max(1024), z.number().int().positive().max(1024)]),
  layers: z.array(catalogIconLayerSchema).min(1).max(MAX_LAYERS),
});

export const catalogSchema = z.strictObject({
  version: z.number().int().min(1).max(2_147_483_647),
  categories: z.array(catalogCategorySchema).max(2000),
  merchants: z.array(catalogMerchantSchema).max(20000),
  icons: z.array(catalogIconSchema).max(2000),
});

export type CatalogCategory = z.infer<typeof catalogCategorySchema>;
export type CatalogMerchant = z.infer<typeof catalogMerchantSchema>;
export type CatalogIcon = z.infer<typeof catalogIconSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
