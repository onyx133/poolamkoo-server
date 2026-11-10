import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '../src/lib/prisma.js';
import { formatSummary, importCatalog } from '../src/modules/catalog/catalog.importer.js';
import { PrismaCatalogRepository } from '../src/modules/catalog/catalog.repository.js';

// Loads seed/catalog-seed.json through the same import code as `catalog:import`, but only when
// no catalog release exists yet. Later versions are published with `npm run catalog:import`.
export async function seedCatalog(prisma: PrismaClient): Promise<void> {
  const existing = await prisma.catalogRelease.findFirst({ select: { version: true } });
  if (existing) {
    console.log(`catalog: release ${existing.version} already present, skipping`);
    return;
  }
  const raw = await readFile(new URL('../seed/catalog-seed.json', import.meta.url), 'utf8');
  const summary = await importCatalog(new PrismaCatalogRepository(prisma), JSON.parse(raw));
  console.log(formatSummary(summary));
}
