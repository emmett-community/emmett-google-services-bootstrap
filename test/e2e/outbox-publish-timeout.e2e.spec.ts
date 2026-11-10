import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { ServiceBootstrap } from '../../src/bootstrap/ServiceBootstrap';
import { restoreEnv } from '../helpers/env';

const projectId = 'demo-project';

// Firestore answers and Pub/Sub does not: the append commits, its publication gives up within the
// publish timeout instead of holding the request, and the event waits in the outbox for the job
void describe('Outbox with Pub/Sub not answering E2E', () => {
  const originalEnv = { ...process.env };
  let emulator: StartedTestContainer | undefined;
  let bootstrap: ServiceBootstrap | undefined;

  before(async () => {
    emulator = await new GenericContainer(
      'myfstartup/firebase-emulator-suite:15',
    )
      .withPlatform('linux/amd64')
      .withExposedPorts(4000, 9099, 8080, 9000, 8085)
      .withBindMounts([
        {
          source: path.join(process.cwd(), 'test', 'firebase', 'firebase.json'),
          target: '/app/firebase.json',
          mode: 'ro' as const,
        },
        {
          source: path.join(process.cwd(), 'test', 'firebase', '.firebaserc'),
          target: '/app/.firebaserc',
          mode: 'ro' as const,
        },
      ])
      .withEnvironment({ PROJECT_ID: projectId })
      .withWaitStrategy(Wait.forHttp('/', 4000).withStartupTimeout(120000))
      .start();

    const host = emulator.getHost();
    process.env.FIRESTORE_EMULATOR_HOST = `${host}:${emulator.getMappedPort(8080)}`;
    process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${host}:${emulator.getMappedPort(9000)}`;
    process.env.PUBSUB_EMULATOR_HOST = '127.0.0.1:1';
    process.env.GCLOUD_PROJECT = projectId;
    process.env.FIRESTORE_PROJECT_ID = projectId;
    process.env.PUBSUB_PROJECT_ID = projectId;

    bootstrap = new ServiceBootstrap({
      serviceName: 'e2e-timeout',
      outbox: { types: ['OrderPlaced'] },
      pubsub: { publishTimeoutMs: 1000 },
      includeDefaultDependencyChecks: false,
    });
  });

  after(async () => {
    await bootstrap?.shutdown('test cleanup', 0);
    await emulator?.stop();
    restoreEnv(originalEnv);
  });

  void it('commits the append, returns within the publish timeout and keeps the event in the outbox', async () => {
    const ctx = await bootstrap!.initialize();
    const startedAt = Date.now();

    const result = await ctx.eventStore.appendToStream('order-1', [
      { type: 'OrderPlaced', data: { orderId: 'order-1' } },
    ]);

    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 5000, `the append took ${elapsedMs} ms`);
    const { messageIds } = result as unknown as { messageIds: string[] };
    const stored = await ctx.eventStore.readStream('order-1');
    assert.equal(stored.events.length, 1);
    const outbox = await ctx.firestore.collection('e2e-timeout-outbox').get();
    assert.deepEqual(
      outbox.docs.map((doc) => doc.id),
      messageIds,
    );
  });
});
