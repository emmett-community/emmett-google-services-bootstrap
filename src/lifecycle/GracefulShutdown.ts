import type { GracefulShutdownConfig, Logger } from '../types/config';

export class ShutdownTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Shutdown task timed out after ${timeoutMs}ms`);
    this.name = 'ShutdownTimeoutError';
  }
}

export type ShutdownTask = {
  name: string;
  close: () => Promise<void>;
  timeoutMs?: number;
};

export type ShutdownTaskResult = {
  name: string;
  ok: boolean;
  timedOut: boolean;
  durationMs: number;
  error?: unknown;
};

export type GracefulShutdownResult = {
  reason: string;
  exitCode: number;
  tasks: ShutdownTaskResult[];
};

const normalizeContext = (data: unknown): Record<string, unknown> => {
  if (data === undefined || data === null) return {};
  if (typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>) };
  }
  return { data };
};

const normalizeErrorContext = (error: unknown): Record<string, unknown> => {
  if (error === undefined || error === null) return {};
  if (error instanceof Error) return { err: error };
  if (typeof error === 'object' && !Array.isArray(error)) {
    return { ...(error as Record<string, unknown>) };
  }
  return { err: error };
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs?: number): Promise<T> => {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new ShutdownTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

/**
 * Runs shutdown tasks with timeout handling and optional exit.
 */
export class GracefulShutdown {
  private readonly logger?: Logger;
  private readonly timeoutMs?: number;
  private readonly exitOnComplete: boolean;
  private readonly exitFn: (code: number) => void;
  private readonly tasks: ShutdownTask[] = [];
  private shuttingDown = false;
  private lastResult?: GracefulShutdownResult;

  constructor(options?: GracefulShutdownConfig & { logger?: Logger }) {
    this.logger = options?.logger;
    this.timeoutMs = options?.timeoutMs;
    this.exitOnComplete = options?.exitOnComplete ?? false;
    this.exitFn = options?.exitFn ?? process.exit;
  }

  /**
   * Register a shutdown task.
   */
  register(task: ShutdownTask): void {
    this.tasks.push(task);
  }

  /**
   * Execute all shutdown tasks and return the aggregated result.
   */
  async shutdown(reason: string, exitCode = 1): Promise<GracefulShutdownResult> {
    if (this.shuttingDown && this.lastResult) {
      return this.lastResult;
    }

    this.shuttingDown = true;
    this.logger?.info({ reason }, 'Shutting down gracefully');

    const results: ShutdownTaskResult[] = [];

    for (const task of this.tasks) {
      const start = Date.now();
      const timeoutMs = task.timeoutMs ?? this.timeoutMs;

      try {
        await withTimeout(task.close(), timeoutMs);
        results.push({
          name: task.name,
          ok: true,
          timedOut: false,
          durationMs: Date.now() - start,
        });
        this.logger?.info(
          { task: task.name, durationMs: Date.now() - start },
          'Shutdown task completed',
        );
      } catch (error) {
        const timedOut = error instanceof ShutdownTimeoutError;
        results.push({
          name: task.name,
          ok: false,
          timedOut,
          durationMs: Date.now() - start,
          error,
        });
        this.logger?.warn(
          {
            task: task.name,
            timedOut,
            durationMs: Date.now() - start,
            ...normalizeErrorContext(error),
          },
          'Shutdown task failed',
        );
      }
    }

    const failed = results.some((result) => !result.ok || result.timedOut);
    const finalExitCode = failed ? exitCode : 0;

    if (failed) {
      const failedTasks = results
        .filter((result) => !result.ok || result.timedOut)
        .map((result) => result.name);
      this.logger?.error(
        normalizeContext({ failedTasks }),
        'Shutdown completed with failures',
      );
    } else {
      this.logger?.info({}, 'Shutdown completed');
    }

    const result = { reason, exitCode: finalExitCode, tasks: results };
    this.lastResult = result;

    if (this.exitOnComplete) {
      this.exitFn(finalExitCode);
    }

    return result;
  }
}
