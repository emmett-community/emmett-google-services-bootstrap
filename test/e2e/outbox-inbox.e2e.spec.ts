import type { Event } from '@event-driven-io/emmett';
import assert from 'node:assert/strict';
import path from 'node:path';
import { before, after, describe, it } from 'node:test';
import {
  GenericContainer,
  Wait,
  type StartedTestContainer,
} from 'testcontainers';
import { ServiceBootstrap } from '../../src/bootstrap/ServiceBootstrap';
import { restoreEnv } from '../helpers/env';

const projectId = 'demo-project';

let emulator: StartedTestContainer | null = null;
let bootstrap: ServiceBootstrap | undefined;

const startEmulator = async () => {
  const container = await new GenericContainer(
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

  const host = container.getHost();
  process.env.FIRESTORE_EMULATOR_HOST = `${host}:${container.getMappedPort(8080)}`;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${host}:${container.getMappedPort(9000)}`;
  process.env.PUBSUB_EMULATOR_HOST = `${host}:${container.getMappedPort(8085)}`;
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_PROJECT_ID = projectId;
  process.env.PUBSUB_PROJECT_ID = projectId;

  return container;
};

const messageIdOf = (event: Event) =>
  (event as Event & { metadata: { messageId: string } }).metadata.messageId;

void describe('Outbox and inbox E2E', () => {
  const originalEnv = { ...process.env };

  before(async () => {
    emulator = await startEmulator();
    bootstrap = new ServiceBootstrap({
      serviceName: 'e2e-outbox',
      outbox: { types: ['OrderPlaced'] },
    });
  });

  after(async () => {
    if (bootstrap) {
      await bootstrap.shutdown('test cleanup', 0);
    }
    if (emulator) {
      await emulator.stop();
    }
    restoreEnv(originalEnv);
  });

  void it('publishes an outbox event after the append commits and handles its delivery once through the inbox', async () => {
    const ctx = await bootstrap!.initialize();
    const received: Event[] = [];
    let handled: Promise<unknown> = Promise.resolve();

    ctx.messageBus.subscribe((event: Event) => {
      received.push(event);
      const handle = () =>
        ctx.inbox.handle({
          handler: 'confirmOrder',
          messageId: messageIdOf(event),
          firestore: async (record) => {
            await ctx.eventStore.appendToStream(
              'confirmation-1',
              [{ type: 'OrderConfirmed', data: { orderId: 'order-1' } }],
              { beforeCommit: record } as Parameters<
                typeof ctx.eventStore.appendToStream
              >[2],
            );
          },
        });
      handled = handle().then(handle);
      return handled.then(() => undefined);
    }, 'OrderPlaced');

    await ctx.messageBus.start();
    const result = await ctx.eventStore.appendToStream('order-1', [
      { type: 'OrderPlaced', data: { orderId: 'order-1' } },
    ]);
    const { messageIds } = result as unknown as { messageIds: string[] };

    const deadline = Date.now() + 10000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await handled;

    assert.equal(received.length, 1);
    assert.equal(messageIdOf(received[0]), messageIds[0]);

    const outbox = await ctx.firestore.collection('e2e-outbox-outbox').get();
    assert.equal(outbox.size, 0);

    const record = await ctx.firestore
      .collection('e2e-outbox-inbox')
      .doc(`confirmOrder:${messageIds[0]}`)
      .get();
    assert.equal(record.data()?.state, 'done');

    const confirmations = await ctx.eventStore.readStream('confirmation-1');
    assert.equal(confirmations.events.length, 1);
  });
});
