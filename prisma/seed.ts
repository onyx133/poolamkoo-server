import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { createPrisma, type PrismaClient } from '../src/lib/prisma.js';
import { seedCatalog } from './seed-catalog.js';

const bandsFile = z.object({
  version: z.number().int().min(1),
  currency: z.literal('IRR'),
  bands: z
    .array(
      z.object({
        key: z.enum(['B1', 'B2', 'B3', 'B4', 'B5']),
        max_monthly_net_income: z.number().int().positive().nullable(),
      }),
    )
    .min(1),
});

async function seedBands(prisma: PrismaClient): Promise<void> {
  const raw = await readFile(new URL('../seed/bands.json', import.meta.url), 'utf8');
  const file = bandsFile.parse(JSON.parse(raw));

  // Ascending, and only the last band may be unbounded.
  file.bands.forEach((band, i) => {
    const next = file.bands[i + 1];
    const last = i === file.bands.length - 1;
    if ((band.max_monthly_net_income === null) !== last) {
      throw new Error(`bands.json: only the last band may be null (band ${band.key})`);
    }
    if (next && band.max_monthly_net_income !== null && next.max_monthly_net_income !== null) {
      if (next.max_monthly_net_income <= band.max_monthly_net_income) {
        throw new Error(`bands.json: bands must be ascending (${band.key} -> ${next.key})`);
      }
    }
  });

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
