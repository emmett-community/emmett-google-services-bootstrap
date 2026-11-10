import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import { promisify } from 'node:util';
import { startTracing } from '../../src/tracing';

const run = promisify(execFile);

// The tracing is loaded with `node --import` before an Express app imported as an ES module, in a
// process of its own, and writes its spans to the console
const runFixture = (environment: NodeJS.ProcessEnv) =>
  run(
    process.execPath,
    [
      '--import',
      'tsx',
      '--import',
      './test/fixtures/tracing/preload.ts',
      './test/fixtures/tracing/server.ts',
    ],
    {
      cwd: path.resolve(import.meta.dirname, '../..'),
      env: { ...process.env, ...environment },
      timeout: 60000,
    },
  );

void describe('Tracing - integration', () => {
  void it('traces the HTTP request and the Express route of an app imported as an ES module', async () => {
    const { stdout } = await runFixture({ OTEL_TRACES_EXPORTER: 'console' });

    assert.match(stdout, /name: '@opentelemetry\/instrumentation-http'/);
    assert.match(stdout, /name: 'GET \/orders\/:orderId'/);
    assert.match(stdout, /name: 'request handler - \/orders\/:orderId'/);
    assert.match(stdout, /'service\.name': 'tracing-fixture'/);
  });

  void it('does nothing without an exporter configured', async () => {
    const { stdout } = await runFixture({
      OTEL_TRACES_EXPORTER: '',
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: '',
    });

    assert.doesNotMatch(stdout, /instrumentationScope/);
  });

  void it('returns a stop function that does nothing when no exporter is configured', async () => {
    const stop = await startTracing({ environmentVariables: {} });

    await stop();
  });
});
