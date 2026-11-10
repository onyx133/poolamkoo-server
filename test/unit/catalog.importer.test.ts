/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- crafts deliberately invalid catalogs */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CatalogImportError,
  canonicalizeCatalog,
  planImport,
  serializeCatalog,
  validateCatalog,
} from '../../src/modules/catalog/catalog.importer.js';
import type { CatalogSnapshot } from '../../src/modules/catalog/catalog.repository.js';
import type { Catalog } from '../../src/modules/catalog/catalog.schemas.js';

const layers: Catalog['icons'][number]['layers'] = [
  { role: 'plate', d: 'M2 2h20v20H2z' },
  { role: 'glyph', d: 'M7 7h10v10H7z' },
  { role: 'accent', d: 'M18 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4z' },
];

function base(): Catalog {
  return structuredClone({
    version: 2,
    categories: [
      {
        key: 'food',
        parent_key: null,
        kind: 'expense',
        name_fa: 'غذا',
        color: '#FF7A59',
        icon_key: 'food',
        sort: 10,
      },
      {
        key: 'food.delivery',
        parent_key: 'food',
        kind: 'expense',
        name_fa: 'سفارش غذا',
        color: '#FF7A59',
        icon_key: 'food',
        sort: 20,
      },
    ],
    merchants: [
      {
        key: 'snappfood',
        name_fa: 'اسنپ‌فود',
        category_key: 'food.delivery',
        icon_key: 'food',
        keywords: ['snappfood', 'اسنپ فود'],
      },
    ],
    icons: [{ key: 'food', view_box: [24, 24], layers }],
  });
}

const empty: CatalogSnapshot = { version: null, categories: [], merchants: [], icons: [] };

function expectRefusal(mutate: (c: Record<string, any>) => void, message: RegExp): void {
  const c = base() as unknown as Record<string, any>;
  mutate(c);
  let error: unknown;
  try {
    validateCatalog(c);
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(CatalogImportError);
  expect((error as CatalogImportError).issues.join('\n')).toMatch(message);
}

describe('validateCatalog', () => {
  it('accepts a well-formed catalog', () => {
    expect(validateCatalog(base())).toEqual(base());
  });

  it('accepts the shipped placeholder seed', () => {
    const raw = readFileSync(new URL('../../seed/catalog-seed.json', import.meta.url), 'utf8');
    const seed = validateCatalog(JSON.parse(raw));
    expect(seed.version).toBe(1);
    expect(seed.categories.some((c) => c.kind === 'neutral')).toBe(true);
    expect(seed.categories.some((c) => c.kind === 'income')).toBe(true);
    expect(seed.merchants.map((m) => m.key)).toEqual(
      expect.arrayContaining(['snappfood', 'digikala', 'tapsi', 'mci', 'jabama', 'oppark']),
    );
  });

  it('rejects unknown properties and wrong types', () => {
    expectRefusal((c) => (c['extra'] = 1), /extra|unrecognized/i);
    expectRefusal((c) => (c['version'] = '2'), /version/);
    expectRefusal((c) => (c['version'] = 0), /version/);
  });

  it('rejects duplicate keys in each collection', () => {
    expectRefusal((c) => c['categories'].push({ ...c['categories'][0] }), /categories: duplicate/);
    expectRefusal((c) => c['merchants'].push({ ...c['merchants'][0] }), /merchants: duplicate/);
    expectRefusal((c) => c['icons'].push({ ...c['icons'][0] }), /icons: duplicate/);
  });

  it('rejects an unknown or cyclic category parent', () => {
    expectRefusal((c) => (c['categories'][1].parent_key = 'nope'), /parent_key "nope"/);
    expectRefusal((c) => (c['categories'][0].parent_key = 'food'), /cycle/);
    expectRefusal((c) => (c['categories'][0].parent_key = 'food.delivery'), /cycle/);
  });

  it('rejects a bad kind and a bad color', () => {
    expectRefusal((c) => (c['categories'][0].kind = 'transfer'), /kind/);
    for (const color of ['FF7A59', '#FF7A5', '#GG7A59', '#FF7A59FF', 'red']) {
      expectRefusal((c) => (c['categories'][0].color = color), /#RRGGBB/);
    }
  });

  it('rejects dangling icon references from categories and merchants', () => {
    expectRefusal((c) => (c['categories'][0].icon_key = 'ghost'), /icon_key "ghost"/);
    expectRefusal((c) => (c['merchants'][0].icon_key = 'ghost'), /icon_key "ghost"/);
  });

  it('rejects a merchant with an unknown category', () => {
    expectRefusal((c) => (c['merchants'][0].category_key = 'ghost'), /category_key "ghost"/);
  });

  it('rejects malformed keys and empty keywords', () => {
    expectRefusal((c) => (c['merchants'][0].key = 'Snapp Food'), /lowercase/);
    expectRefusal((c) => (c['merchants'][0].keywords = ['']), /merchants/);
  });

  it('rejects bad icon view boxes', () => {
    for (const vb of [[24], [24, 0], [24, -1], [24.5, 24], ['24', 24], [24, 24, 24]]) {
      expectRefusal((c) => (c['icons'][0].view_box = vb), /view_box/);
    }
  });

  it('rejects bad icon layers', () => {
    expectRefusal((c) => (c['icons'][0].layers[0].role = 'shadow'), /role/);
    expectRefusal((c) => (c['icons'][0].layers[0].d = ''), /layers/);
    expectRefusal((c) => (c['icons'][0].layers[0].d = '<script>'), /path data/);
    expectRefusal((c) => (c['icons'][0].layers[0].d = `M${'1'.repeat(5000)}`), /layers/);
    expectRefusal((c) => (c['icons'][0].layers = []), /layers/);
    expectRefusal(
      (c) => (c['icons'][0].layers = Array.from({ length: 9 }, () => ({ ...layers[0] }))),
      /layers/,
    );
  });

  it('reports every problem at once', () => {
    try {
      const c = base() as unknown as Record<string, any>;
      c['categories'][0].icon_key = 'ghost';
      c['merchants'][0].category_key = 'ghost';
      validateCatalog(c);
      expect.unreachable();
    } catch (e) {
      expect((e as CatalogImportError).issues).toHaveLength(2);
    }
  });
});

describe('canonical serialization', () => {
  it('is independent of input order and key order', () => {
    const a = base();
    const b = base();
    b.categories.reverse();
    b.icons[0] = { layers: b.icons[0]!.layers, view_box: [24, 24], key: 'food' };
    b.merchants[0] = {
      keywords: ['snappfood', 'اسنپ فود'],
      icon_key: 'food',
      category_key: 'food.delivery',
      name_fa: 'اسنپ‌فود',
      key: 'snappfood',
    };
    expect(serializeCatalog(b).equals(serializeCatalog(a))).toBe(true);
  });

  it('sorts categories by sort then key, merchants and icons by key', () => {
    const c = base();
    c.categories.push({ ...c.categories[0]!, key: 'aaa', sort: 20 });
    c.categories.push({ ...c.categories[0]!, key: 'zzz', sort: 5 });
    c.merchants.push({ ...c.merchants[0]!, key: 'aaa_shop' });
    c.icons.push({ ...c.icons[0]!, key: 'aaa' });
    const out = canonicalizeCatalog(c);
    expect(out.categories.map((x) => x.key)).toEqual(['zzz', 'food', 'aaa', 'food.delivery']);
    expect(out.merchants.map((x) => x.key)).toEqual(['aaa_shop', 'snappfood']);
    expect(out.icons.map((x) => x.key)).toEqual(['aaa', 'food']);
  });

  it('emits compact UTF-8 JSON with the contract key order and unescaped Persian', () => {
    const text = serializeCatalog(base()).toString('utf8');
    expect(
      text.startsWith('{"version":2,"categories":[{"key":"food","parent_key":null,"kind":'),
    ).toBe(true);
    expect(text).toContain('"name_fa":"سفارش غذا"');
    expect(text).not.toMatch(/\s{2}|\n/);
    expect(JSON.parse(text)).toEqual(canonicalizeCatalog(base()));
  });
});

describe('planImport', () => {
  const snapshotOf = (c: Catalog): CatalogSnapshot => ({ ...canonicalizeCatalog(c) });

  it('plans a first import and puts parents before children', () => {
    const c = base();
    c.categories.reverse();
    const plan = planImport(c, empty);
    expect(plan.change.categories.upsert.map((x) => x.key)).toEqual(['food', 'food.delivery']);
    expect(plan.summary.categories).toEqual({ added: 2, updated: 0, removed: 0 });
    expect(plan.summary.merchants).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(plan.summary.icons).toEqual({ added: 1, updated: 0, removed: 0 });
    expect(plan.release.etag).toBe('"catalog-2"');
    expect(plan.release.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires a higher version than the current release', () => {
    const current = snapshotOf({ ...base(), version: 2 });
    expect(() => planImport(base(), { ...current, version: 2 })).toThrow(/greater than/);
    expect(() => planImport(base(), { ...current, version: 3 })).toThrow(/greater than/);
    expect(() => planImport(base(), { ...current, version: 1 })).not.toThrow();
  });

  it('counts updates and refuses removals unless allowed', () => {
    const current = { ...snapshotOf(base()), version: 1 };
    const next = base();
    next.version = 3;
    next.categories[0]!.name_fa = 'خوراک';
    next.merchants = [];
    expect(() => planImport(next, current)).toThrow(/would remove merchant "snappfood"/);

    const plan = planImport(next, current, { allowRemovals: true, dryRun: true });
    expect(plan.summary).toMatchObject({
      dryRun: true,
      categories: { added: 0, updated: 1, removed: 0 },
      merchants: { added: 0, updated: 0, removed: 1 },
    });
    expect(plan.change.merchants.remove).toEqual(['snappfood']);
  });

  it('refuses removing categories and icons too', () => {
    const current = { ...snapshotOf(base()), version: 1 };
    const next = base();
    next.version = 3;
    next.merchants = [];
    next.categories = next.categories.slice(0, 1);
    next.categories[0]!.icon_key = 'other';
    next.icons = [{ key: 'other', view_box: [24, 24], layers }];
    let error: CatalogImportError | undefined;
    try {
      planImport(next, current);
    } catch (e) {
      error = e as CatalogImportError;
    }
    expect(error?.issues.join('\n')).toMatch(/remove category "food.delivery"/);
    expect(error?.issues.join('\n')).toMatch(/remove icon "food"/);
  });

  it('produces identical bytes for identical input', () => {
    const a = planImport(base(), empty).release;
    const b = planImport(base(), empty).release;
    expect(a.sha256).toBe(b.sha256);
    expect(a.body.equals(b.body)).toBe(true);
  });
});
