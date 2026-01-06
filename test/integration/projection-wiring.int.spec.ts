import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventStore } from '../../src/eventstore/EventStoreFactory';
import { createInMemoryDatabase } from '../helpers/inMemoryDatabase';
import { createInMemoryFirestore } from '../helpers/inMemoryFirestore';
import type { RealtimeDBInlineProjectionDefinition } from '@emmett-community/emmett-google-realtime-db';

void describe('Projection Wiring Integration', () => {
  void it('accepts projections configuration', () => {
    const firestore = createInMemoryFirestore();
    const database = createInMemoryDatabase();

    const projection: RealtimeDBInlineProjectionDefinition = {
      name: 'projection',
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
