import type { CatalogRelease, CatalogRepository } from './catalog.repository.js';

export const DEFAULT_RECHECK_MS = 30_000;

export interface CatalogServiceDeps {
  repo: CatalogRepository;
  /** Injected clock (epoch ms) for tests. */
  now?: () => number;
  recheckMs?: number;
}

/**
 * Serves the newest catalog release from memory. The cached release is re-validated against
 * the database (one tiny `SELECT version`) at most every `recheckMs`; the body is only read
 * again when a newer version appeared.
 */
export class CatalogService {
  private readonly repo: CatalogRepository;
  private readonly now: () => number;
  private readonly recheckMs: number;
  private cached: { release: CatalogRelease; checkedAt: number } | null = null;
  private inflight: Promise<CatalogRelease | null> | null = null;

  constructor(deps: CatalogServiceDeps) {
    this.repo = deps.repo;
    this.now = deps.now ?? Date.now;
    this.recheckMs = deps.recheckMs ?? DEFAULT_RECHECK_MS;
  }

  /** The latest release, or null when nothing has been imported yet. */
  async latest(): Promise<CatalogRelease | null> {
    const cached = this.cached;
    if (cached && this.now() - cached.checkedAt < this.recheckMs) return cached.release;
    // Concurrent requests share one refresh.
    this.inflight ??= this.refresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async refresh(): Promise<CatalogRelease | null> {
    const version = await this.repo.latestVersion();
    if (version === null) {
      this.cached = null;
      return null;
    }
    const current = this.cached?.release;
    if (current && current.version === version) {
      this.cached = { release: current, checkedAt: this.now() };
      return current;
    }
    const release = await this.repo.latestRelease();
    if (!release) {
      this.cached = null;
      return null;
    }
    this.cached = { release, checkedAt: this.now() };
    return release;
  }
}
