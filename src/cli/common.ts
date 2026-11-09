import 'dotenv/config';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** User-facing failure: message printed without a stack trace, exit code 1. */
export class CliError extends Error {}

/**
 * Runs `main` only when the module is the process entry point (so tests can import `run`),
 * printing failures as one clean line and exiting non-zero.
 */
export function runIfMain(metaUrl: string, main: () => Promise<void>): void {
  const entry = process.argv[1];
  if (!entry || realpathSync(entry) !== realpathSync(fileURLToPath(metaUrl))) return;
  main().then(
    () => process.exit(0),
    (err: unknown) => {
      if (err instanceof Error && err.name.endsWith('Error')) {
        console.error(err.message);
      } else {
        console.error(err);
      }
      process.exit(1);
    },
  );
}

export function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new CliError(`${name} is not set`);
  return value;
}
