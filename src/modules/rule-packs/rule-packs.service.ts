import type { RulePacksRepository, StoredRulePack } from './rule-packs.repository.js';

export const rulePackEtag = (version: number): string => `"rulepack-${version}"`;

export class RulePacksService {
  constructor(private readonly repo: RulePacksRepository) {}

  /** Newest pack the given app versionCode can load, or null. */
  latestFor(appVersion: number): Promise<StoredRulePack | null> {
    return this.repo.latestFor(appVersion);
  }
}
