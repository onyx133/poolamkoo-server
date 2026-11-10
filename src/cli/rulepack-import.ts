import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { publicKeyFromRaw } from '../lib/ed25519.js';
import { createPrisma } from '../lib/prisma.js';
import { importRulePack } from '../modules/rule-packs/rule-packs.importer.js';
import { PrismaRulePacksRepository } from '../modules/rule-packs/rule-packs.repository.js';
import { CliError, requireEnv, runIfMain } from './common.js';

const USAGE = 'Usage: npm run rulepack:import -- <pack.json> [<pack.json.sig>]';

export async function run(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { positionals } = parseArgs({ args: argv, allowPositionals: true, options: {} });
  const [pack, sig] = positionals;
  if (!pack || positionals.length > 2) throw new CliError(USAGE);

  const rawKey = Buffer.from(requireEnv(env, 'RULEPACK_PUBLIC_KEY'), 'base64');
  if (rawKey.length !== 32) {
    throw new CliError('RULEPACK_PUBLIC_KEY must be a base64 raw 32-byte Ed25519 key');
  }
  const read = async (path: string) => {
    try {
      return await readFile(path);
    } catch {
      throw new CliError(`Cannot read ${path}`);
    }
  };
  const payload = await read(pack);
  const signature = (await read(sig ?? `${pack}.sig`)).toString('utf8');

  const prisma = createPrisma(requireEnv(env, 'DATABASE_URL'));
  try {
    const s = await importRulePack(new PrismaRulePacksRepository(prisma), {
      payload,
      signature,
      publicKey: publicKeyFromRaw(rawKey),
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
