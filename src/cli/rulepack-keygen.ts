import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { generateKeyPair } from '../lib/ed25519.js';
import { isInsideWorkTree } from '../lib/fs-safety.js';
import { CliError, runIfMain } from './common.js';

const USAGE = 'Usage: npm run rulepack:keygen -- --out <private.pem>';
// dist/cli/ or src/cli/ -> project root
const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Writes the private PEM and returns the base64 raw public key. */
export function run(argv: string[], projectRoot: string = PROJECT_ROOT): string {
  const { values } = parseArgs({ args: argv, options: { out: { type: 'string' } } });
  if (!values.out) throw new CliError(USAGE);
  const out = resolve(values.out);

  if (isInsideWorkTree(out, projectRoot)) {
    throw new CliError(
      `Refusing to write a private key inside a repository working tree (${out}). ` +
        'Choose a path outside the repo.',
    );
  }

  const { privatePem, publicRaw } = generateKeyPair();
  mkdirSync(dirname(out), { recursive: true });
  try {
    // 'wx': never overwrite an existing key. 0600: owner-only where the OS supports it.
    writeFileSync(out, privatePem, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new CliError(`${out} already exists; refusing to overwrite`);
    }
    throw err;
  }
  return publicRaw.toString('base64');
}

runIfMain(import.meta.url, async () => {
  const publicKey = run(process.argv.slice(2));
  console.log('Private key written. Keep it off the server and out of git.');
  console.log('Public key (raw 32 bytes, base64) for RULEPACK_PUBLIC_KEY and the app:');
  console.log(publicKey);
});
