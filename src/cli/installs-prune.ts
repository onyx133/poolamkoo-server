import { parseArgs } from 'node:util';
import { loadDbConfig, loadRetentionDays } from '../config.js';
import { createPrisma } from '../lib/prisma.js';
import { PrismaInstallsRepository } from '../modules/installs/installs.repository.js';
import { InstallsService } from '../modules/installs/installs.service.js';
import { CliError, runIfMain } from './common.js';

const USAGE = 'Usage: npm run installs:prune -- [--days N]';

/** Deletes installs not seen for more than N days (default: INSTALL_RETENTION_DAYS, 180). */
export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { days: { type: 'string' } },
  });
  if (positionals.length > 0) throw new CliError(USAGE);

  const days = values.days === undefined ? loadRetentionDays(env) : Number(values.days);
  if (!Number.isInteger(days) || days < 1) {
    throw new CliError(`--days must be a whole number of at least 1 (got ${values.days ?? days})`);
  }

  const db = loadDbConfig(env);
  const prisma = createPrisma(db.databaseUrl, { poolMax: db.dbPoolMax });
  try {
    // The pepper is not needed: pruning works on dates, never on install ids.
    const service = new InstallsService({
      repo: new PrismaInstallsRepository(prisma),
      pepper: Buffer.alloc(0),
    });
    const count = await service.pruneInactive(days);
    console.log(`installs: deleted ${count} install(s) not seen for more than ${days} day(s)`);
    return count;
  } finally {
    await prisma.$disconnect();
  }
}

runIfMain(import.meta.url, async () => {
  await run(process.argv.slice(2));
});
