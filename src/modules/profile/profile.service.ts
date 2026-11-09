import type { ProfileRepository } from './profile.repository.js';
import type { BandTable, PutProfileBody } from './profile.schemas.js';

export const bandsEtag = (version: number): string => `"bands-${version}"`;

export class ProfileService {
  constructor(private readonly repo: ProfileRepository) {}

  async put(idHash: string, body: PutProfileBody): Promise<void> {
    await this.repo.upsert(idHash, body);
  }

  async remove(idHash: string): Promise<void> {
    await this.repo.delete(idHash);
  }

  /** Latest band table, or null when none exists. */
  bands(): Promise<BandTable | null> {
    return this.repo.latestBandTable();
  }
}
