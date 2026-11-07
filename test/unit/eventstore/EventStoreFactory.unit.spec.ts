import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventStore } from '../../../src/eventstore/EventStoreFactory';
import { createInMemoryDatabase } from '../../helpers/inMemoryDatabase';
import { createInMemoryFirestore } from '../../helpers/inMemoryFirestore';
import type { RealtimeDBInlineProjectionDefinition } from '@emmett-community/emmett-google-realtime-db';

void describe('EventStoreFactory - unit', () => {
  void it('creates a Firestore-backed event store', () => {
    const firestore = createInMemoryFirestore();
    const database = createInMemoryDatabase();

    const eventStore = createEventStore({
      firestore,
      database,
    });

    assert.equal(typeof eventStore.appendToStream, 'function');
    assert.equal(typeof eventStore.readStream, 'function');
  });

  void it('accepts projections without failing', () => {
    const firestore = createInMemoryFirestore();
    const database = createInMemoryDatabase();

    const projection: RealtimeDBInlineProjectionDefinition = {
      name: 'test-projection',
      canHandle: ['TestEvent'],
      handle: async () => {},
    };

    const eventStore = createEventStore({
      firestore,
      database,
      projections: [projection],
    });

    assert.equal(typeof eventStore.appendToStream, 'function');
  });

  void it('passes custom collection names to Firestore event store', async () => {
    const firestore = createInMemoryFirestore();
    const database = createInMemoryDatabase();

    const eventStore = createEventStore({
      firestore,
      database,
      collections: {
        streams: 'custom-streams',
        counters: 'custom-counters',
      },
    });

    await eventStore.appendToStream('stream-1', [
      { type: 'TestEvent', data: { value: 1 } },
    ]);

    const events = await firestore
      .collection('custom-streams')
      .doc('stream-1')
      .collection('events')
      .get();
    const counters = await firestore.collection('custom-counters').get();

    assert.equal(events.size, 1);
    assert.equal(counters.size, 1);
  });

  void it('passes the hooks to the Firestore event store', async () => {
    const firestore = createInMemoryFirestore();
    const received: string[] = [];

    const eventStore = createEventStore({
      firestore,
      database: createInMemoryDatabase(),
      hooks: {
        beforeCommit: (transaction, events) => {
          for (const event of events) {
            received.push(event.type);
            transaction.set(firestore.collection('audit').doc(event.messageId), {
              type: event.type,
            });
          }
        },
      },
    });

    const result = (await eventStore.appendToStream('stream-1', [
      { type: 'TestEvent', data: { value: 1 } },
    ])) as unknown as { messageIds: string[] };

    const audit = await firestore.collection('audit').get();
    assert.deepEqual(received, ['TestEvent']);
    assert.deepEqual(
      audit.docs.map((doc) => doc.ref.id),
      result.messageIds,
    );
  });

  void it('exposes the canonical event store contract', async () => {
    const eventStore = createEventStore({
      firestore: createInMemoryFirestore(),
      database: createInMemoryDatabase(),
    });

    await eventStore.appendToStream('stream-1', [
      { type: 'TestEvent', data: { value: 1 } },
    ]);

    const result = await eventStore.readStream('stream-1');

    assert.equal(result.streamExists, true);
    assert.equal(result.events.length, 1);
  });
});
