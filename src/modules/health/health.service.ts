import type { HealthRepository } from './health.repository.js';

export type HealthStatus = { status: 'ok' | 'degraded'; version: string };

export const DB_PING_TIMEOUT_MS = 1000;

export interface HealthServiceDeps {
  version: string;
  repo: HealthRepository;
  timeoutMs?: number;
}

export class HealthService {
  private readonly version: string;
  private readonly repo: HealthRepository;
  private readonly timeoutMs: number;

  constructor(deps: HealthServiceDeps) {
    this.version = deps.version;
    this.repo = deps.repo;
    this.timeoutMs = deps.timeoutMs ?? DB_PING_TIMEOUT_MS;
  }

  /** `ok` when the database answers within the timeout, `degraded` otherwise. */
  async status(): Promise<HealthStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), this.timeoutMs);
    });
    try {
      await Promise.race([this.repo.ping(), timeout]);
      return { status: 'ok', version: this.version };
    } catch {
      return { status: 'degraded', version: this.version };
    } finally {
      clearTimeout(timer);
    }
  }
}
