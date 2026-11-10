/** Flushes the pending spans and stops the exporter. */
export type StopTracing = () => Promise<void>;

/**
 * Where `startTracing` leaves its stop function, so the services bootstrap flushes the spans on
 * shutdown. A global symbol, since the tracing entry is loaded on its own, before the service.
 */
export const TRACING_SHUTDOWN = Symbol.for(
  '@emmett-community/emmett-google-services-bootstrap/tracing-shutdown',
);

type TracingGlobal = { [TRACING_SHUTDOWN]?: StopTracing };

export const setTracingShutdown = (stop: StopTracing): void => {
  (globalThis as TracingGlobal)[TRACING_SHUTDOWN] = stop;
};

/** The stop function left by `startTracing`, when tracing was started. */
export const getTracingShutdown = (): StopTracing | undefined =>
  (globalThis as TracingGlobal)[TRACING_SHUTDOWN];
