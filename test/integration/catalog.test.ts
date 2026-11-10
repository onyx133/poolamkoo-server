import { readFileSync } from 'node:fs';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createContainer } from '../../src/container.js';
import { createPrisma, type PrismaClient } from '../../src/lib/prisma.js';
import { CatalogImportError, importCatalog } from '../../src/modules/catalog/catalog.importer.js';
import { PrismaCatalogRepository } from '../../src/modules/catalog/catalog.repository.js';
import { catalogSchema, type Catalog } from '../../src/modules/catalog/catalog.schemas.js';
import { TEST_ENV } from '../helpers/build-test-app.js';
import { resetDb } from '../helpers/db.js';

const seed = JSON.parse(
  readFileSync(new URL('../../seed/catalog-seed.json', import.meta.url), 'utf8'),
) as Catalog;

describe('catalog', () => {
  let app: FastifyInstance;
  let prisma: PrismaClient;
  let repo: PrismaCatalogRepository;
  const clock = { now: Date.parse('2026-01-01T00:00:00Z') };

  beforeAll(async () => {
    const url = inject('testDatabaseUrl');
    const config = loadConfig({ ...TEST_ENV, DATABASE_URL: url });
    prisma = createPrisma(url);
    app = await buildApp(createContainer(config, prisma, { now: () => clock.now }), config);
    repo = new PrismaCatalogRepository(prisma);
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(prisma);
    clock.now += 3_600_000; // far beyond the cache window: every test starts cold
  });

  const get = (headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: '/v1/catalog', headers });
  const advance = (ms: number) => (clock.now += ms);
  const withVersion = (version: number, patch: (c: Catalog) => void = () => {}): Catalog => {
    const c = structuredClone(seed);
    c.version = version;
    patch(c);
    return c;
  };

  it('is 404 (problem) before the first import, then 200 after it', async () => {
    const missing = await get();
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');
    expect(missing.json()).toMatchObject({ status: 404, type: 'urn:poolamkoo:problem:not-found' });

    const summary = await importCatalog(repo, seed);
    expect(summary.categories.added).toBe(seed.categories.length);
    expect(summary.merchants.added).toBe(seed.merchants.length);
    expect(summary.icons.added).toBe(seed.icons.length);

    // No clock movement: an absent catalog must not have been cached.
    expect((await get()).statusCode).toBe(200);
  });

  it('serves the stored bytes with ETag, cache headers and the contract shape', async () => {
    await importCatalog(repo, seed);
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['etag']).toBe('"catalog-1"');
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.headers['authorization']).toBeUndefined();

    const row = await prisma.catalogRelease.findUniqueOrThrow({ where: { version: 1 } });
    expect(res.rawPayload.equals(Buffer.from(row.body))).toBe(true);
    expect(row.etag).toBe('"catalog-1"');
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);

    const body = catalogSchema.parse(res.json());
    expect(body.version).toBe(1);
    expect(body.categories).toHaveLength(seed.categories.length);
    const delivery = body.categories.find((c) => c.key === 'food.delivery');
    expect(delivery).toMatchObject({ parent_key: 'food', kind: 'expense', name_fa: 'سفارش غذا' });
    const snappfood = body.merchants.find((m) => m.key === 'snappfood');
    expect(snappfood?.keywords).toEqual(expect.arrayContaining(['snappfood', 'اسنپ‌فود']));
    expect(body.icons[0]?.layers.map((l) => l.role)).toEqual(['plate', 'glyph', 'accent']);
  });

  it('is public: no Authorization needed', async () => {
    await importCatalog(repo, seed);
    expect((await get()).statusCode).toBe(200);
  });

  it('answers 304 to a matching If-None-Match (strong, weak, list, *)', async () => {
    await importCatalog(repo, seed);
    for (const header of ['"catalog-1"', 'W/"catalog-1"', '"x", W/"catalog-1"', '*']) {
      const res = await get({ 'if-none-match': header });
      expect(res.statusCode, header).toBe(304);
      expect(res.body).toBe('');
      expect(res.headers['etag']).toBe('"catalog-1"');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    }
    expect((await get({ 'if-none-match': '"catalog-0"' })).statusCode).toBe(200);
  });

  it('picks up a newer release after the cache window and changes the ETag', async () => {
    await importCatalog(repo, seed);
    const first = await get();
    expect(first.headers['etag']).toBe('"catalog-1"');

    const summary = await importCatalog(
      repo,
      withVersion(2, (c) => {
        c.categories[0]!.name_fa = 'غذا (ویرایش‌شده)';
      }),
    );
    expect(summary.categories).toMatchObject({ added: 0, updated: 1, removed: 0 });

    advance(29_000); // still inside the 30 s window
    expect((await get()).headers['etag']).toBe('"catalog-1"');

    advance(1_000);
    const second = await get();
    expect(second.headers['etag']).toBe('"catalog-2"');
    expect(second.json<Catalog>().categories.some((c) => c.name_fa === 'غذا (ویرایش‌شده)')).toBe(
      true,
    );
    // The old ETag no longer matches; the new one does.
    expect((await get({ 'if-none-match': '"catalog-1"' })).statusCode).toBe(200);
    expect((await get({ 'if-none-match': '"catalog-2"' })).statusCode).toBe(304);
  });

  it('refuses a non-increasing version', async () => {
    await importCatalog(repo, seed);
    await expect(importCatalog(repo, withVersion(1))).rejects.toThrow(/greater than/);
    expect(await prisma.catalogRelease.count()).toBe(1);
  });

  it('refuses removals without the flag and applies them with it, in one transaction', async () => {
    await importCatalog(repo, seed);
    const shrunk = withVersion(2, (c) => {
      c.merchants = c.merchants.filter((m) => m.key !== 'snappfood');
    });
    await expect(importCatalog(repo, shrunk)).rejects.toThrow(CatalogImportError);
    expect(await prisma.merchant.count()).toBe(seed.merchants.length);
    expect(await prisma.catalogRelease.count()).toBe(1);

    const dry = await importCatalog(repo, shrunk, { allowRemovals: true, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, merchants: { removed: 1 } });
    expect(await prisma.catalogRelease.count()).toBe(1);

    const done = await importCatalog(repo, shrunk, { allowRemovals: true });
    expect(done.merchants).toEqual({ added: 0, updated: 0, removed: 1 });
    expect(await prisma.merchant.count()).toBe(seed.merchants.length - 1);
    expect(await prisma.catalogRelease.count()).toBe(2);
  });

  it('removes categories and icons it no longer lists, children and dependents first', async () => {
    await importCatalog(repo, seed);
    const shrunk = withVersion(2, (c) => {
      // The whole income subtree: a parent together with all of its children.
      c.categories = c.categories.filter((x) => x.key !== 'income' && x.parent_key !== 'income');
      const used = new Set([
        ...c.categories.map((x) => x.icon_key),
        ...c.merchants.map((m) => m.icon_key),
      ]);
      c.icons = c.icons.filter((i) => used.has(i.key));
    });
    const summary = await importCatalog(repo, shrunk, { allowRemovals: true });
    const removedCategories = seed.categories.filter(
      (x) => x.key === 'income' || x.parent_key === 'income',
    ).length;
    expect(removedCategories).toBeGreaterThan(2);
    expect(summary.categories.removed).toBe(removedCategories);
    expect(summary.icons.removed).toBeGreaterThan(0);
    expect(await prisma.category.count()).toBe(seed.categories.length - removedCategories);
    expect(await prisma.icon.count()).toBe(seed.icons.length - summary.icons.removed);
  });

  it('rolls back every write when the transaction fails after applying', async () => {
    await importCatalog(repo, seed);
    const failing = {
      transact: <T>(fn: Parameters<typeof repo.transact<T>>[0]) =>
        repo.transact((tx) =>
          fn({
            snapshot: () => tx.snapshot(),
            apply: async (change, release) => {
              await tx.apply(change, release);
              throw new Error('boom');
            },
          }),
        ),
    };
    const next = withVersion(2, (c) => {
      c.categories[0]!.name_fa = 'تغییر';
    });
    await expect(importCatalog(failing, next)).rejects.toThrow('boom');
    const category = await prisma.category.findUniqueOrThrow({
      where: { key: seed.categories[0]!.key },
    });
    expect(category.nameFa).toBe(seed.categories[0]!.name_fa);
    expect(await prisma.catalogRelease.count()).toBe(1);
  });

  describe('compression', () => {
    it('compresses large responses with br or gzip and the bytes round-trip', async () => {
      await importCatalog(repo, seed);
      const plain = await get();
      expect(plain.headers['content-encoding']).toBeUndefined();
      expect(plain.rawPayload.length).toBeGreaterThan(10_000);

      const br = await get({ 'accept-encoding': 'br' });
      expect(br.headers['content-encoding']).toBe('br');
      expect(br.headers['etag']).toBe('"catalog-1"');
      expect(br.rawPayload.length).toBeLessThan(plain.rawPayload.length / 2);
      expect(brotliDecompressSync(br.rawPayload).equals(plain.rawPayload)).toBe(true);

      const gz = await get({ 'accept-encoding': 'gzip' });
      expect(gz.headers['content-encoding']).toBe('gzip');
      expect(gunzipSync(gz.rawPayload).equals(plain.rawPayload)).toBe(true);
      expect(String(gz.headers['vary'])).toContain('accept-encoding');
    });
  });

  it('documents the response in OpenAPI', async () => {
    const spec = app.swagger() as {
      paths: Record<
        string,
        { get: { tags: string[]; responses: Record<string, OpenApiResponse> } }
      >;
    };
    const op = spec.paths['/v1/catalog']!.get;
    expect(op.tags).toEqual(['catalog']);
    expect(op.responses['200']!.headers['ETag']).toBeDefined();
    expect(
      op.responses['200']!.content['application/json']!.schema.properties['categories'],
    ).toBeDefined();
    expect(op.responses['304']).toBeDefined();
  });
});

interface OpenApiResponse {
  headers: Record<string, unknown>;
  content: Record<string, { schema: { properties: Record<string, unknown> } }>;
}
