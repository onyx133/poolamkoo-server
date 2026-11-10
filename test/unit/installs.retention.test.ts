import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRetentionJob } from '../../src/modules/installs/installs.retention.js';

const DAY = 24 * 3600 * 1000;

describe('startRetentionJob', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('runs shortly after start and then daily', async () => {
    const pruneInactive = vi.fn().mockResolvedValue(2);
    const onPruned = vi.fn();
    const job = startRetentionJob({ service: { pruneInactive }, days: 180, onPruned });

    await vi.advanceTimersByTimeAsync(59_000);
    expect(pruneInactive).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(pruneInactive).toHaveBeenCalledTimes(1);
    expect(pruneInactive).toHaveBeenCalledWith(180);
    expect(onPruned).toHaveBeenCalledWith(2);

    await vi.advanceTimersByTimeAsync(DAY);
    expect(pruneInactive).toHaveBeenCalledTimes(2);
    job.stop();
  });

  it('schedules nothing when disabled (0 days)', async () => {
    const pruneInactive = vi.fn();
    const job = startRetentionJob({ service: { pruneInactive }, days: 0 });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3 * DAY);
    expect(pruneInactive).not.toHaveBeenCalled();
    job.stop();
  });

  it('stop() cancels the pending runs', async () => {
    const pruneInactive = vi.fn().mockResolvedValue(0);
    const job = startRetentionJob({ service: { pruneInactive }, days: 30 });
    expect(vi.getTimerCount()).toBe(2);
    job.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(pruneInactive).not.toHaveBeenCalled();
  });

  it('survives a failing run and reports it', async () => {
    const boom = new Error('db down');
    const pruneInactive = vi.fn().mockRejectedValueOnce(boom).mockResolvedValue(1);
    const onError = vi.fn();
    const onPruned = vi.fn();
    const job = startRetentionJob({
      service: { pruneInactive },
      days: 30,
      onError,
      onPruned,
      firstRunDelayMs: 10,
      intervalMs: 100,
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(onError).toHaveBeenCalledWith(boom);
    await vi.advanceTimersByTimeAsync(100);
    expect(onPruned).toHaveBeenCalledWith(1);
    job.stop();
  });

  it('does not start a run while the previous one is still going', async () => {
    let release: () => void = () => {};
    const pruneInactive = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          release = () => resolve(0);
        }),
    );
    const job = startRetentionJob({
      service: { pruneInactive },
      days: 30,
      firstRunDelayMs: 10,
      intervalMs: 20,
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(pruneInactive).toHaveBeenCalledTimes(1);
    release();
    job.stop();
  });

  it('unrefs its timers so it never keeps the process alive', () => {
    const unref = vi.fn();
    const handle = { unref, ref: vi.fn(), hasRef: () => false } as unknown as NodeJS.Timeout;
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue(handle);
    vi.spyOn(globalThis, 'setInterval').mockReturnValue(handle);
    startRetentionJob({ service: { pruneInactive: vi.fn() }, days: 1 }).stop();
    expect(unref).toHaveBeenCalledTimes(2);
  });
});
