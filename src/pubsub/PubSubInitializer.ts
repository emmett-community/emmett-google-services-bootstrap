import { PubSub } from '@google-cloud/pubsub';
import type { Logger } from '../types/config';

export type PubSubInitializationOptions = {
  projectId: string;
  emulatorHost?: string;
  logger?: Logger;
  _pubsub?: PubSub;
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

const safeLog = {
  debug: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.debug(normalizeContext(data), msg);
  },
  info: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.info(normalizeContext(data), msg);
  },
  warn: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.warn(normalizeContext(data), msg);
  },
  error: (logger: Logger | undefined, msg: string, error?: unknown): void => {
    if (!logger) return;
    logger.error(normalizeErrorContext(error), msg);
  },
};

/**
 * Initializes PubSub client with optional emulator support.
 */
export class PubSubInitializer {
  private readonly options: PubSubInitializationOptions;

  constructor(options: PubSubInitializationOptions) {
    this.options = options;
  }

  /**
   * Returns true if emulator host is configured.
   */
  isEmulatorMode(): boolean {
    return Boolean(
      this.options.emulatorHost || process.env.PUBSUB_EMULATOR_HOST,
    );
  }

  /**
   * Initialize PubSub client or return injected instance.
   */
  async initialize(): Promise<PubSub> {
    const { projectId, emulatorHost, logger } = this.options;

    if (emulatorHost && !process.env.PUBSUB_EMULATOR_HOST) {
      process.env.PUBSUB_EMULATOR_HOST = emulatorHost;
    }

    if (this.options._pubsub) {
      safeLog.info(logger, 'Using provided PubSub client', {
        projectId,
        emulatorHost: emulatorHost ?? process.env.PUBSUB_EMULATOR_HOST,
      });
      return this.options._pubsub;
    }

    const pubsub = new PubSub({ projectId });

    safeLog.info(logger, 'PubSub initialized', {
      projectId,
      emulatorHost: emulatorHost ?? process.env.PUBSUB_EMULATOR_HOST,
      emulatorMode: this.isEmulatorMode(),
    });

    return pubsub;
  }
}
