import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadDbConfig } from '../config.js';
import { createPrisma } from '../lib/prisma.js';
import { importBands } from '../modules/profile/bands.importer.js';
import { PrismaProfileRepository } from '../modules/profile/profile.repository.js';
import { CliError, runIfMain } from './common.js';

const USAGE = 'Usage: npm run bands:import -- <bands.json>';

/** Publishes a new income-band table version (must be greater than the current one). */
export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const [file] = positionals;
  if (!file || positionals.length !== 1) throw new CliError(USAGE);

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new CliError(
      `Cannot read ${file} as JSON: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  const db = loadDbConfig(env);
  const prisma = createPrisma(db.databaseUrl, { poolMax: db.dbPoolMax });
  try {
    const table = await importBands(new PrismaProfileRepository(prisma), raw);
    console.log(`bands: imported version ${table.version} (${table.bands.length} bands)`);
  } finally {
    await prisma.$disconnect();
  }
}

runIfMain(import.meta.url, () => run(process.argv.slice(2)));
