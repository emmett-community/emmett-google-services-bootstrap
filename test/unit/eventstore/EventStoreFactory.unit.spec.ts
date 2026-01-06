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
});
