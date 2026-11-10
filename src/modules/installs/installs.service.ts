import { hmacInstallId } from '../../lib/crypto.js';
import type { InstallsRepository } from './installs.repository.js';
import type { RegisterInstallBody } from './installs.schemas.js';

export interface InstallsServiceDeps {
  repo: InstallsRepository;
  pepper: Buffer;
  now?: () => Date;
}

const day = (d: Date) => d.toISOString().slice(0, 10);

export class InstallsService {
  private readonly repo: InstallsRepository;
  private readonly pepper: Buffer;
  private readonly now: () => Date;

  constructor(deps: InstallsServiceDeps) {
    this.repo = deps.repo;
    this.pepper = deps.pepper;
    this.now = deps.now ?? (() => new Date());
  }

  /** Register or re-register. `created` is false when the install already existed. */
  async register(input: RegisterInstallBody): Promise<{ idHash: string; created: boolean }> {
    const idHash = hmacInstallId(input.install_id, this.pepper);
    const created = await this.repo.upsert({
      idHash,
      platform: input.platform,
      appVersion: input.app_version,
      store: input.store,
      lastSeenOn: day(this.now()),
    });
    return { idHash, created };
  }

  /** Auth check: does the install still exist? Touches last_seen_on at most once a day. */
  async authenticate(idHash: string): Promise<boolean> {
    const lastSeen = await this.repo.findLastSeenOn(idHash);
    if (lastSeen === null) return false;
    const today = day(this.now());
    if (lastSeen < today) await this.repo.touchLastSeenOn(idHash, today);
    return true;
  }

  async erase(idHash: string): Promise<void> {
    await this.repo.delete(idHash);
  }

  /**
   * Retention: deletes installs not seen for more than `days` days (profiles cascade).
   * An install last seen exactly `days` days ago is kept. Returns how many were deleted.
   */
  async pruneInactive(days: number): Promise<number> {
    const cutoff = new Date(this.now().getTime() - days * 86_400_000);
    return this.repo.deleteLastSeenBefore(day(cutoff));
  }
}
