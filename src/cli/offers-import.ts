import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { ConfigError, loadConfig } from '../config.js';
import { createPrisma } from '../lib/prisma.js';
import {
  OffersFileError,
  parseOffersFile,
  replaceOffers,
} from '../modules/offers/offers.import.js';

// Usage: npm run offers:import -- <offers.json>   (after `npm run build`)
async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path || process.argv.length > 3) {
    throw new OffersFileError('Usage: offers:import <offers.json>');
  }

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new OffersFileError(`Cannot read file: ${path}`);
  }
  const file = parseOffersFile(raw);

  const config = loadConfig();
  const prisma = createPrisma(config.databaseUrl);
  try {
    const count = await replaceOffers(prisma, file);
    const active = file.offers.filter((o) => o.active).length;
    console.log(`offers: replaced the offer set with ${count} offer(s) (${active} active)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  const known = err instanceof OffersFileError || err instanceof ConfigError;
  console.error(known ? err.message : err);
  process.exit(1);
});
