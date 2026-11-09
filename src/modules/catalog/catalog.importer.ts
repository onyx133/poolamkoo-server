import { createHash } from 'node:crypto';
import type {
  CatalogChange,
  CatalogImportRepository,
  CatalogSnapshot,
  NewCatalogRelease,
} from './catalog.repository.js';
import {
  catalogSchema,
  type Catalog,
  type CatalogCategory,
  type CatalogIcon,
  type CatalogMerchant,
} from './catalog.schemas.js';

export class CatalogImportError extends Error {
  constructor(readonly issues: string[]) {
    super(`Catalog import refused:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'CatalogImportError';
  }
}

// ---------------------------------------------------------------------------------------
// Canonical form: explicit key order everywhere and a stable row order, so the same
// catalog always serializes to the same bytes (and the same sha256).

const canonCategory = (c: CatalogCategory): CatalogCategory => ({
  key: c.key,
  parent_key: c.parent_key,
  kind: c.kind,
  name_fa: c.name_fa,
  color: c.color,
  icon_key: c.icon_key,
  sort: c.sort,
});

const canonMerchant = (m: CatalogMerchant): CatalogMerchant => ({
  key: m.key,
  name_fa: m.name_fa,
  category_key: m.category_key,
  icon_key: m.icon_key,
  keywords: [...m.keywords],
});

const canonIcon = (i: CatalogIcon): CatalogIcon => ({
  key: i.key,
  view_box: [i.view_box[0], i.view_box[1]],
  layers: i.layers.map((l) => ({ role: l.role, d: l.d })),
});

const byKey = (a: { key: string }, b: { key: string }) =>
  a.key < b.key ? -1 : a.key > b.key ? 1 : 0;

export function canonicalizeCatalog(catalog: Catalog): Catalog {
  return {
    version: catalog.version,
    categories: catalog.categories
      .map(canonCategory)
      .sort((a, b) => a.sort - b.sort || byKey(a, b)),
    merchants: catalog.merchants.map(canonMerchant).sort(byKey),
    icons: catalog.icons.map(canonIcon).sort(byKey),
  };
}

/** The exact bytes served by `GET /v1/catalog`: compact JSON, UTF-8, canonical order. */
export function serializeCatalog(catalog: Catalog): Buffer {
  return Buffer.from(JSON.stringify(canonicalizeCatalog(catalog)), 'utf8');
}

export function catalogEtag(version: number): string {
  return `"catalog-${version}"`;
}

// ---------------------------------------------------------------------------------------
// Validation

function duplicates(keys: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const k of keys) (seen.has(k) ? dup : seen).add(k);
  return [...dup];
}

/** Zod shape check plus referential integrity. Throws CatalogImportError with every problem. */
export function validateCatalog(raw: unknown): Catalog {
  const parsed = catalogSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CatalogImportError(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const catalog = parsed.data;
  const issues: string[] = [];

  for (const [label, rows] of [
    ['categories', catalog.categories],
    ['merchants', catalog.merchants],
    ['icons', catalog.icons],
  ] as const) {
    for (const k of duplicates(rows.map((r) => r.key)))
      issues.push(`${label}: duplicate key "${k}"`);
  }

  const iconKeys = new Set(catalog.icons.map((i) => i.key));
  const categoryByKey = new Map(catalog.categories.map((c) => [c.key, c]));

  catalog.categories.forEach((c, idx) => {
    const at = `categories[${idx}] (${c.key})`;
    if (c.parent_key !== null && !categoryByKey.has(c.parent_key)) {
      issues.push(`${at}: parent_key "${c.parent_key}" does not exist`);
    }
    if (!iconKeys.has(c.icon_key)) issues.push(`${at}: icon_key "${c.icon_key}" does not exist`);
  });

  // Cycles: walk up from every category; a revisit (or a self-parent) is a cycle.
  for (const c of catalog.categories) {
    const seen = new Set<string>([c.key]);
    for (let p = c.parent_key; p !== null;) {
      if (seen.has(p)) {
        issues.push(`categories (${c.key}): parent chain forms a cycle`);
        break;
      }
      seen.add(p);
      p = categoryByKey.get(p)?.parent_key ?? null;
    }
  }

  catalog.merchants.forEach((m, idx) => {
    const at = `merchants[${idx}] (${m.key})`;
    if (!categoryByKey.has(m.category_key)) {
      issues.push(`${at}: category_key "${m.category_key}" does not exist`);
    }
    if (!iconKeys.has(m.icon_key)) issues.push(`${at}: icon_key "${m.icon_key}" does not exist`);
  });

  if (issues.length > 0) throw new CatalogImportError(issues);
  return catalog;
}

// ---------------------------------------------------------------------------------------
// Planning

export interface EntityCounts {
  added: number;
  updated: number;
  removed: number;
}

export interface CatalogImportSummary {
  version: number;
  dryRun: boolean;
  categories: EntityCounts;
  merchants: EntityCounts;
  icons: EntityCounts;
  sha256: string;
  bytes: number;
}

interface EntityDiff<T> {
  upsert: T[];
  remove: string[];
  counts: EntityCounts;
}

function diff<T extends { key: string }>(existing: T[], next: T[]): EntityDiff<T> {
  const before = new Map(existing.map((e) => [e.key, JSON.stringify(e)]));
  const after = new Set(next.map((n) => n.key));
  const upsert: T[] = [];
  let added = 0;
  let updated = 0;
  for (const n of next) {
    const old = before.get(n.key);
    if (old === undefined) added++;
    else if (old !== JSON.stringify(n)) updated++;
    else continue;
    upsert.push(n);
  }
  const remove = existing.map((e) => e.key).filter((k) => !after.has(k));
  return { upsert, remove, counts: { added, updated, removed: remove.length } };
}

/** Parents before children (depth in the given tree), ties broken by key. */
function parentsFirst(categories: CatalogCategory[], tree: CatalogCategory[]): CatalogCategory[] {
  const parentOf = new Map(tree.map((c) => [c.key, c.parent_key]));
  const depth = (key: string): number => {
    let d = 0;
    for (let p = parentOf.get(key) ?? null; p !== null; p = parentOf.get(p) ?? null) d++;
    return d;
  };
  return [...categories].sort((a, b) => depth(a.key) - depth(b.key) || byKey(a, b));
}

export interface ImportOptions {
  allowRemovals?: boolean;
  dryRun?: boolean;
}

export function planImport(
  catalog: Catalog,
  current: CatalogSnapshot,
  options: ImportOptions = {},
): { change: CatalogChange; release: NewCatalogRelease; summary: CatalogImportSummary } {
  if (current.version !== null && catalog.version <= current.version) {
    throw new CatalogImportError([
      `version ${catalog.version} must be greater than the current release (${current.version})`,
    ]);
  }

  const next = canonicalizeCatalog(catalog);
  const existing = canonicalizeCatalog({ ...current, version: current.version ?? 0 });
  const icons = diff(existing.icons, next.icons);
  const categories = diff(existing.categories, next.categories);
  const merchants = diff(existing.merchants, next.merchants);

  if (!options.allowRemovals) {
    const issues = (
      [
        ['category', categories.remove],
        ['merchant', merchants.remove],
        ['icon', icons.remove],
      ] as const
    )
      .flatMap(([label, keys]) => keys.map((k) => `would remove ${label} "${k}"`))
      .map((m) => `${m} (pass --allow-removals to permit)`);
    if (issues.length > 0) throw new CatalogImportError(issues);
  }

  const body = serializeCatalog(catalog);
  const sha256 = createHash('sha256').update(body).digest('hex');
  return {
    change: {
      icons: { upsert: icons.upsert, remove: icons.remove },
      categories: {
        upsert: parentsFirst(categories.upsert, next.categories),
        remove: categories.remove,
      },
      merchants: { upsert: merchants.upsert, remove: merchants.remove },
    },
    release: { version: catalog.version, etag: catalogEtag(catalog.version), body, sha256 },
    summary: {
      version: catalog.version,
      dryRun: options.dryRun ?? false,
      categories: categories.counts,
      merchants: merchants.counts,
      icons: icons.counts,
      sha256,
      bytes: body.length,
    },
  };
}

/** Validate, plan against the live tables and (unless dry-run) apply, all in one transaction. */
export async function importCatalog(
  repo: CatalogImportRepository,
  raw: unknown,
  options: ImportOptions = {},
): Promise<CatalogImportSummary> {
  const catalog = validateCatalog(raw);
  return repo.transact(async (tx) => {
    const plan = planImport(catalog, await tx.snapshot(), options);
    if (!options.dryRun) await tx.apply(plan.change, plan.release);
    return plan.summary;
  });
}

export function formatSummary(s: CatalogImportSummary): string {
  const line = (label: string, c: EntityCounts) =>
    `  ${label.padEnd(11)} +${c.added} added, ~${c.updated} updated, -${c.removed} removed`;
  return [
    `${s.dryRun ? 'Dry run: would import' : 'Imported'} catalog version ${s.version} (${s.bytes} bytes, sha256 ${s.sha256})`,
    line('categories', s.categories),
    line('merchants', s.merchants),
    line('icons', s.icons),
  ].join('\n');
}
