import type { InstallsService } from './installs.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionJob {
  stop(): void;
}

export interface RetentionJobOptions {
  service: Pick<InstallsService, 'pruneInactive'>;
  /** Retention period in days; 0 disables the job (nothing is scheduled). */
  days: number;
  /** Receives the number of installs deleted by a successful run. */
  onPruned?: (count: number) => void;
  onError?: (err: unknown) => void;
  /** Delay before the first run (default 1 minute). */
  firstRunDelayMs?: number;
  /** Time between runs (default 24 h). */
  intervalMs?: number;
}

/**
 * In-process daily clean-up of installs that were not seen for `days` days. Timers are
 * unref'd so they never keep the process alive; call `stop()` on shutdown.
 */
export function startRetentionJob(options: RetentionJobOptions): RetentionJob {
  const { service, days } = options;
  if (days <= 0) return { stop: () => {} };

  let running = false;
  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      // (not `onPruned?.(await ...)`: optional calls skip evaluating their arguments)
      const count = await service.pruneInactive(days);
      options.onPruned?.(count);
    } catch (err) {
      options.onError?.(err);
    } finally {
      running = false;
    }
  };

  const first = setTimeout(() => void run(), options.firstRunDelayMs ?? 60_000);
  const every = setInterval(() => void run(), options.intervalMs ?? DAY_MS);
  first.unref();
  every.unref();
  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
  };
}
