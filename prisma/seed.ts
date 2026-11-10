import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { createPrisma, type PrismaClient } from '../src/lib/prisma.js';
import { parseBandsFile } from '../src/modules/profile/bands.importer.js';
import { seedCatalog } from './seed-catalog.js';

async function seedBands(prisma: PrismaClient): Promise<void> {
  const raw = await readFile(new URL('../seed/bands.json', import.meta.url), 'utf8');
  const file = parseBandsFile(JSON.parse(raw));

  // Versions are immutable once published: seed a version only if it does not exist yet.
  const existing = await prisma.bandTable.findUnique({ where: { version: file.version } });
  if (existing) {
    console.log(`band_tables: version ${file.version} already present, skipping`);
    return;
  }
  await prisma.bandTable.create({
    data: { version: file.version, currency: file.currency, bands: file.bands },
  });
  console.log(`band_tables: seeded version ${file.version}`);
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = createPrisma(url);
  try {
    await seedBands(prisma);
    await seedCatalog(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
