import { register } from 'node:module';
import { initTracing } from '@emmett-community/emmett-observability';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { setTracingShutdown, type StopTracing } from './shutdown';

export type { StopTracing } from './shutdown';

export type StartTracingOptions = {
  /** Defaults to `OTEL_SERVICE_NAME`. */
  serviceName?: string;
  serviceVersion?: string;
  /** Defaults to `NODE_ENV`. */
  environment?: string;
  environmentVariables?: NodeJS.ProcessEnv;
};

const noTracing: StopTracing = () => Promise.resolve();

/**
 * Starts OpenTelemetry tracing for the process, with spans for incoming and outgoing HTTP
 * requests and for the Express routes, next to the spans of the Emmett libraries.
 *
 * Load it before the code it instruments, with `node --import`:
 *
 * ```ts
 * // src/tracing.ts, run as `node --import ./dist/tracing.js dist/index.js`
 * import { startTracing } from '@emmett-community/emmett-google-services-bootstrap/tracing';
 * await startTracing({ serviceName: 'orders-service' });
 * ```
 *
 * It does nothing unless an exporter is configured through the standard environment variables:
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT` export over OTLP/HTTP, for
 * example to an OpenTelemetry Collector, and `OTEL_TRACES_EXPORTER=console` writes the spans to
 * the console. The services bootstrap flushes the pending spans on shutdown.
 */
export const startTracing = async (
  options: StartTracingOptions = {},
): Promise<StopTracing> => {
  const environment = options.environmentVariables ?? process.env;
  const toOtlp = Boolean(
    environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
    environment.OTEL_EXPORTER_OTLP_ENDPOINT,
  );
  const toConsole = environment.OTEL_TRACES_EXPORTER === 'console';
  if (!toOtlp && !toConsole) return noTracing;

  const stop = await initTracing({
    serviceName:
      options.serviceName ?? environment.OTEL_SERVICE_NAME ?? 'unknown_service',
    serviceVersion: options.serviceVersion,
    environment: options.environment ?? environment.NODE_ENV,
    exporter: toConsole ? { type: 'console' } : { type: 'otlp' },
  });

  // The instrumentations patch modules when they are required; this hook lets them patch the
  // modules a service imports as ES modules too, such as Express
  register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

  registerInstrumentations({
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
  });

  setTracingShutdown(stop);
  return stop;
};
