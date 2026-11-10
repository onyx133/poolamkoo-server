import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadRulePackCliConfig } from '../config.js';
import { publicKeyFromRaw } from '../lib/ed25519.js';
import { createPrisma } from '../lib/prisma.js';
import { importRulePack } from '../modules/rule-packs/rule-packs.importer.js';
import { PrismaRulePacksRepository } from '../modules/rule-packs/rule-packs.repository.js';
import { CliError, runIfMain } from './common.js';

const USAGE = 'Usage: npm run rulepack:import -- <pack.json> [<pack.json.sig>]';

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const [pack, sig] = positionals;
  if (!pack || positionals.length > 2) throw new CliError(USAGE);

  const config = loadRulePackCliConfig(env);
  const read = async (path: string) => {
    try {
      return await readFile(path);
    } catch {
      throw new CliError(`Cannot read ${path}`);
    }
  };
  const payload = await read(pack);
  const signature = (await read(sig ?? `${pack}.sig`)).toString('utf8');

  const prisma = createPrisma(config.databaseUrl, { poolMax: config.dbPoolMax });
  try {
    const s = await importRulePack(new PrismaRulePacksRepository(prisma), {
      payload,
      signature,
      publicKey: publicKeyFromRaw(config.rulepackPublicKey),
    });
    console.log(
      `Imported rule pack version ${s.version} (format ${s.formatVersion}, minAppVersion ` +
        `${s.minAppVersion}, ${s.bytes} bytes, sha256 ${s.sha256})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

runIfMain(import.meta.url, () => run(process.argv.slice(2)));
