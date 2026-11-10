import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export { PrismaClient };

export interface PrismaOptions {
  /** Maximum pooled connections (default 10). */
  poolMax?: number;
}

export const DEFAULT_POOL_MAX = 10;
// Fail fast when the database is unreachable or the pool is exhausted, instead of queueing
// requests forever.
const CONNECTION_TIMEOUT_MS = 3000;

export function createPrisma(databaseUrl: string, options: PrismaOptions = {}): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: options.poolMax ?? DEFAULT_POOL_MAX,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    }),
  });
}
