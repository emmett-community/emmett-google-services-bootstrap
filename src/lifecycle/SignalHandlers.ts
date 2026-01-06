import type { Logger } from '../types/config';

export type SignalHandlerOptions = {
  shutdown: (reason: string, exitCode?: number) => void | Promise<void>;
  signals?: NodeJS.Signals[];
  logger?: Logger;
  exitCode?: number;
};

/**
 * Register process signal handlers and return an unregister function.
 */
export const registerSignalHandlers = (
  options: SignalHandlerOptions,
): (() => void) => {
  const signals = options.signals ?? ['SIGINT', 'SIGTERM'];
  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of signals) {
    const handler = () => {
      options.logger?.info({ signal }, 'Shutdown signal received');
      void options.shutdown(`Signal ${signal} received`, options.exitCode ?? 0);
    };

    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers.entries()) {
      process.off(signal, handler);
    }
  };
};
