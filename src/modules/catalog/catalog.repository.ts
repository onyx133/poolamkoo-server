import { z } from 'zod';
import type { PrismaClient } from '../../lib/prisma.js';
import {
  catalogIconLayerSchema,
  type CatalogCategory,
  type CatalogIcon,
  type CatalogMerchant,
} from './catalog.schemas.js';

export interface CatalogRelease {
  version: number;
  /** Quoted entity tag, e.g. `"catalog-42"`. */
  etag: string;
  /** The exact serialized `/v1/catalog` JSON. */
  body: Buffer;
}

/** Read side used by `GET /v1/catalog`. */
export interface CatalogRepository {
  /** Cheap check: the newest release version, or null when none exists. */
  latestVersion(): Promise<number | null>;
  latestRelease(): Promise<CatalogRelease | null>;
}

/** What the normalised tables currently hold. */
export interface CatalogSnapshot {
  version: number | null;
  categories: CatalogCategory[];
  merchants: CatalogMerchant[];
  icons: CatalogIcon[];
}

/** The rows to write; `upsert` lists are already in dependency order (parents first). */
export interface CatalogChange {
  icons: { upsert: CatalogIcon[]; remove: string[] };
  categories: { upsert: CatalogCategory[]; remove: string[] };
  merchants: { upsert: CatalogMerchant[]; remove: string[] };
}

export interface NewCatalogRelease {
  version: number;
  etag: string;
  body: Buffer;
  sha256: string;
}

export interface CatalogImportTx {
  snapshot(): Promise<CatalogSnapshot>;
  apply(change: CatalogChange, release: NewCatalogRelease): Promise<void>;
}

/** Write side used by the importer: one transaction, imports serialized against each other. */
export interface CatalogImportRepository {
  transact<T>(fn: (tx: CatalogImportTx) => Promise<T>): Promise<T>;
}

// Arbitrary constant: serializes concurrent `catalog:import` runs.
const IMPORT_LOCK_KEY = 7_361_001;
const TRANSACTION_TIMEOUT_MS = 60_000;

const layersSchema = z.array(catalogIconLayerSchema);

export class PrismaCatalogRepository implements CatalogRepository, CatalogImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async latestVersion(): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ version: number }[]>`
      SELECT version FROM catalog_releases ORDER BY version DESC LIMIT 1`;
    return rows[0]?.version ?? null;
  }

  async latestRelease(): Promise<CatalogRelease | null> {
    const row = await this.prisma.catalogRelease.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true, etag: true, body: true },
    });
    return row ? { version: row.version, etag: row.etag, body: Buffer.from(row.body) } : null;
  }

  async transact<T>(fn: (tx: CatalogImportTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${IMPORT_LOCK_KEY})`;
        return fn({
          snapshot: async () => {
            const [latest, categories, merchants, icons] = await Promise.all([
              tx.catalogRelease.findFirst({
                orderBy: { version: 'desc' },
                select: { version: true },
              }),
              tx.category.findMany(),
              tx.merchant.findMany(),
              tx.icon.findMany(),
            ]);
            return {
              version: latest?.version ?? null,
              categories: categories.map((c) => ({
                key: c.key,
                parent_key: c.parentKey,
                kind: c.kind,
                name_fa: c.nameFa,
                color: c.color,
                icon_key: c.iconKey,
                sort: c.sort,
              })),
              merchants: merchants.map((m) => ({
                key: m.key,
                name_fa: m.nameFa,
                category_key: m.categoryKey,
                icon_key: m.iconKey,
                keywords: m.keywords,
              })),
              icons: icons.map((i) => ({
                key: i.key,
                view_box: [i.viewBoxW, i.viewBoxH] as [number, number],
                layers: layersSchema.parse(i.layers),
              })),
            };
          },
          apply: async (change, release) => {
            for (const icon of change.icons.upsert) {
              const data = {
                viewBoxW: icon.view_box[0],
                viewBoxH: icon.view_box[1],
                layers: icon.layers,
              };
              await tx.icon.upsert({
                where: { key: icon.key },
                create: { key: icon.key, ...data },
                update: data,
              });
            }
            for (const c of change.categories.upsert) {
              const data = {
                parentKey: c.parent_key,
                kind: c.kind,
                nameFa: c.name_fa,
                color: c.color,
                iconKey: c.icon_key,
                sort: c.sort,
              };
              await tx.category.upsert({
                where: { key: c.key },
                create: { key: c.key, ...data },
                update: data,
              });
            }
            for (const m of change.merchants.upsert) {
              const data = {
                nameFa: m.name_fa,
                categoryKey: m.category_key,
                iconKey: m.icon_key,
                keywords: m.keywords,
              };
              await tx.merchant.upsert({
                where: { key: m.key },
                create: { key: m.key, ...data },
                update: data,
              });
            }
            // Dependents first: merchants, then categories, then icons.
            await tx.merchant.deleteMany({ where: { key: { in: change.merchants.remove } } });
            await tx.category.deleteMany({ where: { key: { in: change.categories.remove } } });
            await tx.icon.deleteMany({ where: { key: { in: change.icons.remove } } });
            await tx.catalogRelease.create({
              data: {
                version: release.version,
                etag: release.etag,
                body: new Uint8Array(release.body),
                sha256: release.sha256,
              },
            });
          },
        });
      },
      { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 10_000 },
    );
  }
}
