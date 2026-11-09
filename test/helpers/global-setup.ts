import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

// Applies the committed SQL migrations exactly as production does.
function migrate(databaseUrl: string): void {
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`prisma migrate deploy failed:\n${result.stdout}\n${result.stderr}`);
  }
}

// Uses TEST_DATABASE_URL when set (CI service container); otherwise starts a throwaway
// Postgres in a temp dir on a random port and removes it afterwards.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env['TEST_DATABASE_URL'];
  if (external) {
    migrate(external);
    project.provide('testDatabaseUrl', external);
    return async () => {};
  }

  const dir = mkdtempSync(join(tmpdir(), 'poolamkoo-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('poolamkoo_test');

  const url = `postgresql://postgres:postgres@127.0.0.1:${port}/poolamkoo_test`;
  migrate(url);
  project.provide('testDatabaseUrl', url);

  return async () => {
    try {
      await pg.stop();
    } catch {
      // On Windows, embedded-postgres' own cleanup can hit EBUSY while the server's files are
      // still being released; the temp dir is removed below on a best-effort basis.
    }
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    } catch {
      // Leftover temp dir is harmless.
    }
  };
}
