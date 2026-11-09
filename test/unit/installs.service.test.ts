import { describe, expect, it } from 'vitest';
import { hmacInstallId } from '../../src/lib/crypto.js';
import type {
  InstallsRepository,
  UpsertInstall,
} from '../../src/modules/installs/installs.repository.js';
import { InstallsService } from '../../src/modules/installs/installs.service.js';

class FakeInstallsRepository implements InstallsRepository {
  rows = new Map<string, UpsertInstall>();
  touches: { idHash: string; day: string }[] = [];

  upsert(input: UpsertInstall): Promise<boolean> {
    const created = !this.rows.has(input.idHash);
    this.rows.set(input.idHash, input);
    return Promise.resolve(created);
  }
  findLastSeenOn(idHash: string): Promise<string | null> {
    return Promise.resolve(this.rows.get(idHash)?.lastSeenOn ?? null);
  }
  touchLastSeenOn(idHash: string, day: string): Promise<void> {
    this.touches.push({ idHash, day });
    const row = this.rows.get(idHash);
    if (row) row.lastSeenOn = day;
    return Promise.resolve();
  }
  delete(idHash: string): Promise<void> {
    this.rows.delete(idHash);
    return Promise.resolve();
  }
}

const pepper = Buffer.alloc(32, 9);
const input = {
  install_id: '3f0c1c52-7a1e-4d0e-9a39-0f6f5f2a8c11',
  platform: 'android' as const,
  app_version: '0.1.0',
  store: 'bazaar' as const,
};

function setup(start = '2026-11-10T10:00:00Z') {
  const repo = new FakeInstallsRepository();
  let now = new Date(start);
  const service = new InstallsService({ repo, pepper, now: () => now });
  return { repo, service, setNow: (iso: string) => (now = new Date(iso)) };
}

describe('InstallsService.register', () => {
  it('stores only the HMAC and reports creation', async () => {
    const { repo, service } = setup();
    const result = await service.register(input);
    expect(result).toEqual({ idHash: hmacInstallId(input.install_id, pepper), created: true });
    expect([...repo.rows.keys()]).toEqual([result.idHash]);
    expect(JSON.stringify([...repo.rows.values()])).not.toContain(input.install_id);
    expect(repo.rows.get(result.idHash)?.lastSeenOn).toBe('2026-11-10');
  });

  it('reports created=false for an existing install and refreshes its fields', async () => {
    const { repo, service, setNow } = setup();
    const first = await service.register(input);
    setNow('2026-11-12T01:00:00Z');
    const second = await service.register({ ...input, store: 'myket', app_version: '0.2.0' });
    expect(second).toEqual({ idHash: first.idHash, created: false });
    expect(repo.rows.get(first.idHash)).toMatchObject({
      store: 'myket',
      appVersion: '0.2.0',
      lastSeenOn: '2026-11-12',
    });
  });
});

describe('InstallsService.authenticate', () => {
  it('is false for unknown installs and never creates one', async () => {
    const { repo, service } = setup();
    expect(await service.authenticate('f'.repeat(64))).toBe(false);
    expect(repo.rows.size).toBe(0);
  });

  it('touches last_seen_on at most once per day', async () => {
    const { repo, service, setNow } = setup();
    const { idHash } = await service.register(input);

    expect(await service.authenticate(idHash)).toBe(true);
    expect(await service.authenticate(idHash)).toBe(true);
    expect(repo.touches).toHaveLength(0); // same day as registration

    setNow('2026-11-11T00:00:01Z');
    await service.authenticate(idHash);
    await service.authenticate(idHash);
    await service.authenticate(idHash);
    expect(repo.touches).toEqual([{ idHash, day: '2026-11-11' }]);
  });
});

describe('InstallsService.erase', () => {
  it('deletes the install and makes authenticate fail', async () => {
    const { service } = setup();
    const { idHash } = await service.register(input);
    await service.erase(idHash);
    expect(await service.authenticate(idHash)).toBe(false);
    await expect(service.erase(idHash)).resolves.toBeUndefined(); // idempotent
  });
});
