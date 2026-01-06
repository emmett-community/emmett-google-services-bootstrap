import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventStore } from '../../src/eventstore/EventStoreFactory';
import { createInMemoryDatabase } from '../helpers/inMemoryDatabase';
import { createInMemoryFirestore } from '../helpers/inMemoryFirestore';

void describe('Event Recording Integration', () => {
  void it('creates a Firestore-backed event store instance', () => {
    const firestore = createInMemoryFirestore();
    const database = createInMemoryDatabase();

    const eventStore = createEventStore({ firestore, database });

    assert.equal((eventStore as any).firestore, firestore);
  });
});
