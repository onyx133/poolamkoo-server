import type { PrismaClient } from '../src/lib/prisma.js';

// HOOK for the catalog engineer: load seed/catalog-seed.json here, only when the catalog is
// empty (no catalog_releases row), by reusing the same import code as `catalog:import`.
// prisma/seed.ts already calls this after seeding the band table.
export async function seedCatalog(_prisma: PrismaClient): Promise<void> {
  console.log('catalog: seeding not implemented yet (see prisma/seed-catalog.ts)');
}
