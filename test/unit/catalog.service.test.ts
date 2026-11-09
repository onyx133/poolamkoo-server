import { describe, expect, it } from 'vitest';
import type {
  CatalogRelease,
  CatalogRepository,
} from '../../src/modules/catalog/catalog.repository.js';
import { CatalogService } from '../../src/modules/catalog/catalog.service.js';

class FakeRepo implements CatalogRepository {
  release: CatalogRelease | null = null;
  versionCalls = 0;
  releaseCalls = 0;

  publish(version: number): void {
    this.release = { version, etag: `"catalog-${version}"`, body: Buffer.from(`{"v":${version}}`) };
  }
  latestVersion(): Promise<number | null> {
    this.versionCalls++;
    return Promise.resolve(this.release?.version ?? null);
  }
  latestRelease(): Promise<CatalogRelease | null> {
    this.releaseCalls++;
    return Promise.resolve(this.release);
  }
}

describe('CatalogService cache', () => {
  function setup() {
    const repo = new FakeRepo();
    const clock = { t: 1_000_000 };
    const service = new CatalogService({ repo, now: () => clock.t });
    return { repo, clock, service };
  }

  it('returns null without caching the absence', async () => {
    const { repo, service } = setup();
    expect(await service.latest()).toBeNull();
    repo.publish(1);
    expect((await service.latest())?.version).toBe(1);
  });

  it('serves from memory for 30 s, then re-checks only the version', async () => {
    const { repo, clock, service } = setup();
    repo.publish(1);
    await service.latest();
    expect([repo.versionCalls, repo.releaseCalls]).toEqual([1, 1]);

    clock.t += 29_999;
    await service.latest();
    expect([repo.versionCalls, repo.releaseCalls]).toEqual([1, 1]);

    clock.t += 1;
    expect((await service.latest())?.version).toBe(1);
    expect([repo.versionCalls, repo.releaseCalls]).toEqual([2, 1]);

    // The re-check restarted the window.
    clock.t += 29_000;
    await service.latest();
    expect(repo.versionCalls).toBe(2);
  });

  it('loads the body again when a newer version appears', async () => {
    const { repo, clock, service } = setup();
    repo.publish(1);
    await service.latest();
    repo.publish(2);
    expect((await service.latest())?.version).toBe(1);
    clock.t += 30_000;
    expect((await service.latest())?.version).toBe(2);
    expect(repo.releaseCalls).toBe(2);
  });

  it('shares one refresh between concurrent callers', async () => {
    const { repo, service } = setup();
    repo.publish(1);
    await Promise.all([service.latest(), service.latest(), service.latest()]);
    expect(repo.versionCalls).toBe(1);
  });
});
