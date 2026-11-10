import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadDbConfig } from '../config.js';
import { createPrisma } from '../lib/prisma.js';
import { PrismaOffersRepository } from '../modules/offers/offers.repository.js';
import {
  OffersFileError,
  parseOffersFile,
  replaceOffers,
} from '../modules/offers/offers.import.js';
import { CliError, runIfMain } from './common.js';

const USAGE = 'Usage: npm run offers:import -- <offers.json>';

/** Replaces the whole offer set from a JSON file, in one transaction. */
export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const [path] = positionals;
  if (!path || positionals.length !== 1) throw new CliError(USAGE);

  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new OffersFileError(`Cannot read file: ${path}`);
  }
  const file = parseOffersFile(raw);

  const db = loadDbConfig(env);
  const prisma = createPrisma(db.databaseUrl, { poolMax: db.dbPoolMax });
  try {
    const count = await replaceOffers(new PrismaOffersRepository(prisma), file);
    const active = file.offers.filter((o) => o.active).length;
    console.log(`offers: replaced the offer set with ${count} offer(s) (${active} active)`);
  } finally {
    await prisma.$disconnect();
  }
}

runIfMain(import.meta.url, () => run(process.argv.slice(2)));
