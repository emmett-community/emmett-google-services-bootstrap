import type { Event } from '@event-driven-io/emmett';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppendToStreamOptions } from '@emmett-community/emmett-google-firestore';
import type { RealtimeDBInlineProjectionDefinition } from '@emmett-community/emmett-google-realtime-db';
import { createTestServiceBootstrap } from '../../../src/testing';
import { createInMemoryDatabase } from '../../helpers/inMemoryDatabase';

const waitFor = async (condition: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

void describe('createTestServiceBootstrap - unit', () => {
  void it('starts with the default dependency checks on in-memory services', async () => {
    const { bootstrap } = createTestServiceBootstrap({ serviceName: 'orders' });

    const ctx = await bootstrap.start();

    assert.equal(ctx.serviceName, 'orders');
    assert.equal((await ctx.checkReadiness()).ok, true);

    await bootstrap.shutdown('test', 0);
  });

  void it('appends and reads events through the real event store', async () => {
    const { bootstrap, firestore } = createTestServiceBootstrap({
      serviceName: 'orders',
    });
    const ctx = await bootstrap.initialize();

    await ctx.eventStore.appendToStream('order-1', [
      { type: 'OrderCreated', data: { id: 'order-1' } },
    ]);

    const result = await ctx.eventStore.readStream('order-1');
    assert.equal(result.streamExists, true);
    assert.equal(result.events.length, 1);

    const stored = await firestore
      .collection('streams')
      .doc('order-1')
      .collection('events')
      .get();
    assert.equal(stored.size, 1);

    await bootstrap.shutdown('test', 0);
  });

  void it('runs the beforeCommit of one append in its transaction, through the wrappers', async () => {
    const { bootstrap, firestore } = createTestServiceBootstrap({
      serviceName: 'orders',
    });
    const ctx = await bootstrap.initialize();
    const claim = (key: string): AppendToStreamOptions => ({
      beforeCommit: (transaction) => {
        transaction.create(firestore.collection('claims').doc(key) as never, {
          key,
        });
      },
    });
    const created = { type: 'OrderCreated', data: { id: 'order' } };

    await ctx.eventStore.appendToStream(
      'order-1',
      [created],
      claim('message-1'),
    );
    await assert.rejects(
      ctx.eventStore.appendToStream('order-2', [created], claim('message-1')),
    );

    assert.equal((await firestore.collection('claims').get()).size, 1);
    assert.equal(
      (await ctx.eventStore.readStream('order-2')).streamExists,
      false,
    );

    await bootstrap.shutdown('test', 0);
  });

  void it('gives the projections the stored messageId and the metadata given on append', async () => {
    const received: Array<Record<string, unknown>> = [];
    const projection: RealtimeDBInlineProjectionDefinition = {
      name: 'trace',
      canHandle: ['OrderCreated'],
      handle: (events) => {
        received.push(
          ...events.map((event) => event.metadata as Record<string, unknown>),
        );
        return Promise.resolve();
      },
    };
    const { bootstrap } = createTestServiceBootstrap({
      serviceName: 'orders',
      projections: [projection],
    });
    const ctx = await bootstrap.initialize();

    await ctx.eventStore.appendToStream('order-1', [
      {
        type: 'OrderCreated',
        data: { id: 'order-1' },
        metadata: { causationId: 'message-that-caused-it' },
      },
    ]);

    const [stored] = (await ctx.eventStore.readStream('order-1')).events;
    assert.equal(received.length, 1);
    assert.equal(received[0].messageId, stored.metadata.messageId);
    assert.equal(received[0].causationId, 'message-that-caused-it');

    await bootstrap.shutdown('test', 0);
  });

  void it('delivers published events to subscribers', async () => {
    const { bootstrap } = createTestServiceBootstrap({ serviceName: 'orders' });
    const ctx = await bootstrap.initialize();
    const received: string[] = [];

    ctx.messageBus.subscribe((event: Event) => {
      received.push(event.type);
      return Promise.resolve();
    }, 'OrderCreated');
    await bootstrap.start();

    await ctx.messageBus.publish({
      type: 'OrderCreated',
      data: { id: 'order-1' },
    });
    await waitFor(() => received.length === 1);

    assert.deepEqual(received, ['OrderCreated']);

    await bootstrap.shutdown('test', 0);
  });

  void it('lets the caller replace the in-memory pieces', async () => {
    const database = createInMemoryDatabase();
    const { bootstrap, database: used } = createTestServiceBootstrap({
      serviceName: 'orders',
      overrides: { database },
    });

    assert.equal(used, database);
    assert.equal((await bootstrap.initialize()).database, database);
  });

  void it('keeps the service configuration given by the caller', () => {
    const { bootstrap } = createTestServiceBootstrap({
      serviceName: 'orders',
      includeRealtimeDatabaseCheck: false,
      pubsub: { topicPrefix: 'test' },
    });

    const config = bootstrap.getConfig();

    assert.equal(config.includeRealtimeDatabaseCheck, false);
    assert.equal(config.pubsub.topicPrefix, 'test');
    assert.equal(config.pubsub.projectId, 'test-project');
  });
});
