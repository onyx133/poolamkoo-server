import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { Ed25519Error, privateKeyFromPem, signDetached } from '../lib/ed25519.js';
import { CliError, runIfMain } from './common.js';

const USAGE = 'Usage: npm run rulepack:sign -- <pack.json> --key <private.pem>';

/** Writes `<pack>.sig` (base64 detached Ed25519 over the exact file bytes); returns its path. */
export async function run(argv: string[]): Promise<string> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { key: { type: 'string' } },
  });
  const [pack] = positionals;
  if (!pack || positionals.length !== 1 || !values.key) throw new CliError(USAGE);

  let key;
  try {
    key = privateKeyFromPem(await readFile(values.key, 'utf8'));
  } catch (err) {
    if (err instanceof Ed25519Error) throw new CliError(`${values.key}: ${err.message}`);
    throw new CliError(`Cannot read key ${values.key}`);
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(pack);
  } catch {
    throw new CliError(`Cannot read ${pack}`);
  }
  const sigPath = `${pack}.sig`;
  await writeFile(sigPath, `${signDetached(bytes, key)}\n`, 'utf8');
  return sigPath;
}

runIfMain(import.meta.url, async () => {
  console.log(`Wrote ${await run(process.argv.slice(2))}`);
});
