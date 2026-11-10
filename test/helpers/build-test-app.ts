import type { FastifyInstance } from 'fastify';
import { inject } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig, type Config } from '../../src/config.js';
import { createContainer } from '../../src/container.js';
import { createPrisma, type PrismaClient } from '../../src/lib/prisma.js';
import type { Writable } from 'node:stream';

// 32+ byte test secrets; never used outside tests.
export const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  SERVER_PEPPER: 'a'.repeat(64),
  JWT_SECRET: 'b'.repeat(64),
  RATE_LIMIT_MAX: '1000',
} as const;

export interface TestApp {
  app: FastifyInstance;
  config: Config;
  prisma: PrismaClient;
  close: () => Promise<void>;
}

export interface TestAppOptions {
  /** Extra/override env, e.g. { RATE_LIMIT_MAX: '2' }. */
  env?: Record<string, string>;
  logStream?: Writable;
  /** Override the database URL (e.g. an unreachable one). */
  databaseUrl?: string;
}

export async function buildTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const databaseUrl = options.databaseUrl ?? inject('testDatabaseUrl');
  const config = loadConfig({ ...TEST_ENV, DATABASE_URL: databaseUrl, ...options.env });
  const prisma = createPrisma(databaseUrl);
  const app = await buildApp(createContainer(config, prisma), config, {
    ...(options.logStream ? { logStream: options.logStream } : {}),
  });
  return {
    app,
    config,
    prisma,
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}
