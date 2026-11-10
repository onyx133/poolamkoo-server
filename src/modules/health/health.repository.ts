import type { PrismaClient } from '../../lib/prisma.js';

export interface HealthRepository {
  /** Resolves when the database answers a trivial query; rejects otherwise. */
  ping(): Promise<void>;
}

export class PrismaHealthRepository implements HealthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async ping(): Promise<void> {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
