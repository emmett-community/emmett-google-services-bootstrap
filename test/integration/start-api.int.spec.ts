import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createTestServiceBootstrap } from '../../src/testing';

const fixtures = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'probes-api',
);

const startService = async (options: { started?: boolean } = {}) => {
  const { bootstrap, messageBus } = createTestServiceBootstrap({
    serviceName: 'orders',
    observability: { createLogger: false },
  });

  const { server } = await bootstrap.startApi({
    openApiPath: path.join(fixtures, 'openapi.yml'),
    handlersPath: path.join(fixtures, 'handlers'),
    port: 0,
    registerSignalHandlers: false,
    initializeHandlers: (handlers, ctx) =>
      (
        handlers as {
          health: { initializeHandlers: (context: typeof ctx) => void };
        }
      ).health.initializeHandlers(ctx),
  });

  if (options.started === false) {
    await messageBus.close();
  }

  const { port } = server.address() as AddressInfo;
  return { bootstrap, baseUrl: `http://127.0.0.1:${port}` };
};

void describe('startApi - integration', () => {
  void it('serves /health and /ready from the contract', async () => {
    const { bootstrap, baseUrl } = await startService();

    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
      status: 'ready',
      checks: [
        { name: 'Firestore', ok: true },
        { name: 'Realtime Database', ok: true },
        { name: 'PubSub', ok: true },
      ],
    });

    await bootstrap.shutdown('test', 0);
  });

  void it('answers /ready with 503 while the message bus is not running', async () => {
    const { bootstrap, baseUrl } = await startService({ started: false });

    const ready = await fetch(`${baseUrl}/ready`);
    assert.equal(ready.status, 503);
    const body = (await ready.json()) as { status: string; checks: unknown[] };
    assert.equal(body.status, 'unavailable');
    assert.deepEqual(body.checks, [
      { name: 'Firestore', ok: true },
      { name: 'Realtime Database', ok: true },
      { name: 'PubSub', ok: false },
    ]);

    await bootstrap.shutdown('test', 0);
  });

  void it('closes the HTTP server before the stores and the message bus', async () => {
    const { bootstrap } = await startService();

    const result = await bootstrap.shutdown('test', 0);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      result.tasks.map((task) => task.name),
      ['httpServer', 'messageBus', 'firestore', 'firebaseApp'],
    );
  });
});
