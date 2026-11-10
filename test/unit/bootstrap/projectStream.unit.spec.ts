import type { Event } from '@event-driven-io/emmett';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  asEventStore,
  getFirestoreEventStore,
} from '@emmett-community/emmett-google-firestore';
import { realtimeDBInlineProjection } from '@emmett-community/emmett-google-realtime-db';
import { createTestServiceBootstrap } from '../../../src/testing';

type ItemAdded = Event<'ItemAdded', { orderId: string }>;
type OrderSummary = { orderId: string; items: number };

const orderSummary = realtimeDBInlineProjection({
  name: 'orderSummary',
  canHandle: ['ItemAdded'],
  evolve: (document: OrderSummary | null, event: ItemAdded): OrderSummary => ({
    orderId: event.data.orderId,
    items: (document?.items ?? 0) + 1,
  }),
});

const added = (): ItemAdded => ({
  type: 'ItemAdded',
  data: { orderId: 'order-1' },
});

const summaryPath = 'projections/orderSummary/order-1';

void describe('Events missed by a projection, with the Firestore event store - unit', () => {
  // A process that stops between the commit and the projection: the event is stored in Firestore,
  // the read model is not written. Appending with a store that has no projections does that.
  void it('applies the missed event with the next append of the stream', async () => {
    const { bootstrap, database, firestore } = createTestServiceBootstrap({
      serviceName: 'orders',
      projections: [orderSummary],
    });
    const ctx = await bootstrap.initialize();
    const withoutProjections = asEventStore(getFirestoreEventStore(firestore));

    await ctx.eventStore.appendToStream('order-1', [added()]);
    await withoutProjections.appendToStream('order-1', [added()]);
    await ctx.eventStore.appendToStream('order-1', [added()]);

    const snapshot = await database.ref(summaryPath).once('value');
    assert.equal((snapshot.val() as OrderSummary).items, 3);

    await bootstrap.shutdown('test', 0);
  });

  void it('applies the first events when the read model was never written', async () => {
    const { bootstrap, database, firestore } = createTestServiceBootstrap({
      serviceName: 'orders',
      projections: [orderSummary],
    });
    const ctx = await bootstrap.initialize();
    const withoutProjections = asEventStore(getFirestoreEventStore(firestore));

    await withoutProjections.appendToStream('order-1', [added()]);
    await ctx.eventStore.appendToStream('order-1', [added()]);

    const snapshot = await database.ref(summaryPath).once('value');
    assert.equal((snapshot.val() as OrderSummary).items, 2);

    await bootstrap.shutdown('test', 0);
  });
});

void describe('projectStream - unit', () => {
  void it('rebuilds a read model that was lost from the stored events', async () => {
    const { bootstrap, database } = createTestServiceBootstrap({
      serviceName: 'orders',
      projections: [orderSummary],
    });
    const ctx = await bootstrap.initialize();
    await ctx.eventStore.appendToStream('order-1', [added(), added()]);
    await database.ref(summaryPath).remove();

    await ctx.projectStream('order-1');

    const snapshot = await database.ref(summaryPath).once('value');
    assert.equal((snapshot.val() as OrderSummary).items, 2);

    await bootstrap.shutdown('test', 0);
  });

  void it('changes nothing when the read model is up to date', async () => {
    const { bootstrap, database } = createTestServiceBootstrap({
      serviceName: 'orders',
      projections: [orderSummary],
    });
    const ctx = await bootstrap.initialize();
    await ctx.eventStore.appendToStream('order-1', [added(), added()]);

    await ctx.projectStream('order-1');

    const snapshot = await database.ref(summaryPath).once('value');
    assert.equal((snapshot.val() as OrderSummary).items, 2);

    await bootstrap.shutdown('test', 0);
  });

  void it('applies on top of the rebuilt read model the events appended afterwards', async () => {
    const { bootstrap, database } = createTestServiceBootstrap({
      serviceName: 'orders',
      projections: [orderSummary],
    });
    const ctx = await bootstrap.initialize();
    await ctx.eventStore.appendToStream('order-1', [added()]);
    await database.ref(summaryPath).remove();

    await ctx.projectStream('order-1');
    await ctx.eventStore.appendToStream('order-1', [added()]);

    const snapshot = await database.ref(summaryPath).once('value');
    assert.equal((snapshot.val() as OrderSummary).items, 2);

    await bootstrap.shutdown('test', 0);
  });

  void it('does nothing for a stream that does not exist', async () => {
    const { bootstrap, database } = createTestServiceBootstrap({
      serviceName: 'orders',
      projections: [orderSummary],
    });
    const ctx = await bootstrap.initialize();

    await ctx.projectStream('order-1');

    const snapshot = await database.ref(summaryPath).once('value');
    assert.equal(snapshot.exists(), false);

    await bootstrap.shutdown('test', 0);
  });
});
