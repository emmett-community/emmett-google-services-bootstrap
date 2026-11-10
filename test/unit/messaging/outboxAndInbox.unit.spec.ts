import type { Event } from '@event-driven-io/emmett';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppendToStreamOptions } from '@emmett-community/emmett-google-firestore';
import type { RealtimeDBInlineProjectionDefinition } from '@emmett-community/emmett-google-realtime-db';
import type { Firestore } from '@google-cloud/firestore';
import { createTestServiceBootstrap } from '../../../src/testing';
import type { TestServiceBootstrapOptions } from '../../../src/testing';

type OrderPlaced = Event<'OrderPlaced', { orderId: string }>;
type OrderNoteAdded = Event<'OrderNoteAdded', { orderId: string }>;

const waitFor = async (condition: () => boolean, timeoutMs = 1000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for the condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const readDocument = async (
  firestore: Firestore,
  collection: string,
  id: string,
): Promise<Record<string, unknown> | undefined> => {
  const snapshot = await firestore.collection(collection).get();
  return snapshot.docs.find((document) => document.ref.id === id)?.data();
};

const startWithSubscriber = async (options: TestServiceBootstrapOptions) => {
  const service = createTestServiceBootstrap(options);
  const received: Event[] = [];
  service.messageBus.subscribe((event: Event) => {
    received.push(event);
    return Promise.resolve();
  }, 'OrderPlaced');
  const ctx = await service.bootstrap.start();
  return { ...service, ctx, received };
};

const placed = (orderId: string): OrderPlaced => ({
  type: 'OrderPlaced',
  data: { orderId },
});

void describe('Outbox and inbox of the service - unit', () => {
  void it('has no outbox when none is configured, and publishes nothing on append', async () => {
    const { bootstrap, ctx, received } = await startWithSubscriber({
      serviceName: 'orders',
    });

    await ctx.eventStore.appendToStream('order-1', [placed('order-1')]);
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(ctx.outbox, undefined);
    assert.equal(received.length, 0);

    await bootstrap.shutdown('test', 0);
  });

  void it('publishes an outbox type after the append commits, with the stored messageId', async () => {
    const { bootstrap, ctx, firestore, received } = await startWithSubscriber({
      serviceName: 'orders',
      outbox: { types: ['OrderPlaced'] },
    });

    const result = await ctx.eventStore.appendToStream('order-1', [
      placed('order-1'),
    ]);
    const { messageIds } = result as unknown as { messageIds: string[] };

    await waitFor(() => received.length === 1);
    assert.equal(received[0].type, 'OrderPlaced');
    assert.deepEqual(received[0].data, { orderId: 'order-1' });
    assert.equal(
      (received[0] as Event & { metadata: { messageId: string } }).metadata
        .messageId,
      messageIds[0],
    );

    const left = await firestore.collection('orders-outbox').get();
    assert.equal(left.size, 0);

    await bootstrap.shutdown('test', 0);
  });

  void it('keeps the other event types in the service', async () => {
    const { bootstrap, ctx, firestore } = await startWithSubscriber({
      serviceName: 'orders',
      outbox: { types: ['OrderPlaced'] },
    });
    const published: string[] = [];
    const publish = ctx.messageBus.publish.bind(ctx.messageBus);
    ctx.messageBus.publish = (event) => {
      published.push(event.type);
      return publish(event);
    };

    const note: OrderNoteAdded = {
      type: 'OrderNoteAdded',
      data: { orderId: 'order-1' },
    };
    await ctx.eventStore.appendToStream('order-1', [note]);

    assert.deepEqual(published, []);
    const stored = await firestore.collection('orders-outbox').get();
    assert.equal(stored.size, 0);

    await bootstrap.shutdown('test', 0);
  });

  void it('keeps a failed publication in the outbox and publishes it in the recovery run', async () => {
    let now = 1_000_000;
    const { bootstrap, ctx, firestore, received } = await startWithSubscriber({
      serviceName: 'orders',
      outbox: { types: ['OrderPlaced'], minAgeMs: 1000, now: () => now },
    });
    const publish = ctx.messageBus.publish.bind(ctx.messageBus);
    ctx.messageBus.publish = () =>
      Promise.reject(new Error('Pub/Sub unavailable'));

    await ctx.eventStore.appendToStream('order-1', [placed('order-1')]);

    const pending = await firestore.collection('orders-outbox').get();
    assert.equal(pending.size, 1);
    assert.equal(received.length, 0);

    ctx.messageBus.publish = publish;
    now += 2000;
    const recovery = await ctx.outbox!.publishPending();

    assert.equal(recovery.published, 1);
    await waitFor(() => received.length === 1);
    const left = await firestore.collection('orders-outbox').get();
    assert.equal(left.size, 0);

    await bootstrap.shutdown('test', 0);
  });

  void it('uses the configured outbox collection and still runs the configured store hook', async () => {
    const { bootstrap, ctx, firestore } = await startWithSubscriber({
      serviceName: 'orders',
      outbox: {
        types: ['OrderPlaced'],
        collection: 'sales-outbox',
        minAgeMs: 0,
      },
      eventStore: {
        hooks: {
          beforeCommit: (transaction, events) => {
            for (const event of events) {
              transaction.set(
                firestore.collection('audit').doc(event.messageId),
                { type: event.type },
              );
            }
          },
        },
      },
    });
    ctx.messageBus.publish = () =>
      Promise.reject(new Error('Pub/Sub unavailable'));

    const result = await ctx.eventStore.appendToStream('order-1', [
      placed('order-1'),
    ]);
    const { messageIds } = result as unknown as { messageIds: string[] };

    const outbox = await readDocument(firestore, 'sales-outbox', messageIds[0]);
    const audit = await readDocument(firestore, 'audit', messageIds[0]);
    assert.notEqual(outbox, undefined);
    assert.deepEqual(audit, { type: 'OrderPlaced' });

    await bootstrap.shutdown('test', 0);
  });

  void it('keeps reading streams and running the projections with the outbox', async () => {
    const projected: string[] = [];
    const projection: RealtimeDBInlineProjectionDefinition = {
      name: 'orders',
      canHandle: ['OrderPlaced'],
      handle: (events) => {
        projected.push(...events.map((event) => event.type));
        return Promise.resolve();
      },
    };
    const { bootstrap, ctx } = await startWithSubscriber({
      serviceName: 'orders',
      outbox: { types: ['OrderPlaced'] },
      projections: [projection],
    });

    await ctx.eventStore.appendToStream('order-1', [placed('order-1')]);

    const stream = await ctx.eventStore.readStream('order-1');
    assert.equal(stream.events.length, 1);
    assert.deepEqual(projected, ['OrderPlaced']);

    await bootstrap.shutdown('test', 0);
  });

  void it('handles a message once through the inbox, with the record in the transaction of the append', async () => {
    const { bootstrap, firestore } = createTestServiceBootstrap({
      serviceName: 'orders',
    });
    const ctx = await bootstrap.initialize();
    let appends = 0;

    const handle = () =>
      ctx.inbox.handle({
        handler: 'placeOrder',
        messageId: 'message-1',
        firestore: async (record) => {
          appends++;
          const options: AppendToStreamOptions = { beforeCommit: record };
          await ctx.eventStore.appendToStream(
            'order-1',
            [placed('order-1')],
            options,
          );
        },
      });

    const first = await handle();
    const second = await handle();

    assert.equal(first.outcome, 'handled');
    assert.equal(second.outcome, 'duplicate');
    assert.equal(appends, 1);
    const record = await readDocument(
      firestore,
      'orders-inbox',
      'placeOrder:message-1',
    );
    assert.equal(record?.state, 'done');

    await bootstrap.shutdown('test', 0);
  });

  void it('uses the configured inbox collection', async () => {
    const { bootstrap, firestore } = createTestServiceBootstrap({
      serviceName: 'orders',
      inbox: { collection: 'sales-inbox' },
    });
    const ctx = await bootstrap.initialize();

    await ctx.inbox.handle({ handler: 'noop', messageId: 'message-1' });

    const record = await readDocument(
      firestore,
      'sales-inbox',
      'noop:message-1',
    );
    assert.equal(record?.state, 'done');

    await bootstrap.shutdown('test', 0);
  });
});
