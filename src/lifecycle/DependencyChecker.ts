import type { DependencyCheck, Logger } from '../types/config';

export class DependencyTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Dependency check timed out after ${timeoutMs}ms`);
    this.name = 'DependencyTimeoutError';
  }
}

export type DependencyCheckResult = {
  name: string;
  ok: boolean;
  required: boolean;
  durationMs: number;
  timedOut: boolean;
  error?: unknown;
};

export type DependencyCheckSummary = {
  ok: boolean;
  results: DependencyCheckResult[];
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
      reject(new DependencyTimeoutError(timeoutMs));
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
 * Helper for one-off dependency checks with optional logging.
 */
export const startDependency = async (
  dependency: string,
  startFn: () => Promise<void>,
  options?: {
    logger?: Logger;
    successMessage?: string;
    timeoutMs?: number;
  },
): Promise<boolean> => {
  const { logger, successMessage, timeoutMs } = options ?? {};
  const startTime = Date.now();

  try {
    await withTimeout(startFn(), timeoutMs);
    logger?.info({ dependency, durationMs: Date.now() - startTime }, successMessage);
    return true;
  } catch (error) {
    logger?.warn(
      { dependency, durationMs: Date.now() - startTime, ...normalizeErrorContext(error) },
      'Unable to reach dependency',
    );
    return false;
  }
};

/**
 * Executes dependency checks with optional timeouts.
 */
export class DependencyChecker {
  private readonly logger?: Logger;
  private readonly defaultTimeoutMs?: number;

  constructor(options?: { logger?: Logger; defaultTimeoutMs?: number }) {
    this.logger = options?.logger;
    this.defaultTimeoutMs = options?.defaultTimeoutMs;
  }

  async check(dependency: DependencyCheck): Promise<DependencyCheckResult> {
    const start = Date.now();
    const timeoutMs = dependency.timeoutMs ?? this.defaultTimeoutMs;

    try {
      await withTimeout(dependency.check(), timeoutMs);

      if (dependency.successMessage) {
        this.logger?.info(
          { dependency: dependency.name, durationMs: Date.now() - start },
          dependency.successMessage,
        );
      }

      return {
        name: dependency.name,
        ok: true,
        required: dependency.required ?? true,
        durationMs: Date.now() - start,
        timedOut: false,
      };
    } catch (error) {
      const timedOut = error instanceof DependencyTimeoutError;

      this.logger?.warn(
        {
          dependency: dependency.name,
          durationMs: Date.now() - start,
          timedOut,
          ...normalizeErrorContext(error),
        },
        'Dependency check failed',
      );

      return {
        name: dependency.name,
        ok: false,
        required: dependency.required ?? true,
        durationMs: Date.now() - start,
        timedOut,
        error,
      };
    }
  }

  async checkAll(dependencies: DependencyCheck[]): Promise<DependencyCheckSummary> {
    const results: DependencyCheckResult[] = [];

    for (const dependency of dependencies) {
      results.push(await this.check(dependency));
    }

    const ok = results.every((result) => result.ok || !result.required);

    return { ok, results };
  }
}
