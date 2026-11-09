import type { PrismaClient } from '../../src/lib/prisma.js';

// Tables owned by modules. WIRE-HERE: add new tables when you add them to the schema.
const TABLES = [
  'installs',
  'profiles',
  'band_tables',
  'offers',
  'categories',
  'merchants',
  'icons',
  'catalog_releases',
  'rule_packs',
];

export async function resetDb(prisma: PrismaClient): Promise<void> {
  const list = TABLES.map((t) => `"${t}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
