import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HealthRepository } from '../../src/modules/health/health.repository.js';
import { HealthService } from '../../src/modules/health/health.service.js';

const make = (ping: HealthRepository['ping'], timeoutMs?: number) =>
  new HealthService({ version: '1.2.3', repo: { ping }, ...(timeoutMs ? { timeoutMs } : {}) });

describe('HealthService', () => {
  afterEach(() => vi.useRealTimers());

  it('is ok when the database answers', async () => {
    await expect(make(() => Promise.resolve()).status()).resolves.toEqual({
      status: 'ok',
      version: '1.2.3',
    });
  });

  it('is degraded when the ping fails', async () => {
    await expect(make(() => Promise.reject(new Error('down'))).status()).resolves.toEqual({
      status: 'degraded',
      version: '1.2.3',
    });
  });

  it('is degraded when the ping hangs past the timeout', async () => {
    vi.useFakeTimers();
    const pending = make(() => new Promise<void>(() => {}), 1000).status();
    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toEqual({ status: 'degraded', version: '1.2.3' });
  });

  it('does not leave a timer behind after a fast answer', async () => {
    vi.useFakeTimers();
    await make(() => Promise.resolve()).status();
    expect(vi.getTimerCount()).toBe(0);
  });
});
