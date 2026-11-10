import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadDbConfig } from '../config.js';
import { createPrisma } from '../lib/prisma.js';
import { formatSummary, importCatalog } from '../modules/catalog/catalog.importer.js';
import { PrismaCatalogRepository } from '../modules/catalog/catalog.repository.js';
import { CliError, runIfMain } from './common.js';

const USAGE = 'Usage: npm run catalog:import -- <file> [--allow-removals] [--dry-run]';

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'allow-removals': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });
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
    const summary = await importCatalog(new PrismaCatalogRepository(prisma), raw, {
      allowRemovals: values['allow-removals'],
      dryRun: values['dry-run'],
    });
    console.log(formatSummary(summary));
  } finally {
    await prisma.$disconnect();
  }
}

runIfMain(import.meta.url, () => run(process.argv.slice(2)));
