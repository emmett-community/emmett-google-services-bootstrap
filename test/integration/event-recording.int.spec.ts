import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEventStore } from '../../src/eventstore/EventStoreFactory';
import { createInMemoryDatabase } from '../helpers/inMemoryDatabase';
import { createInMemoryFirestore } from '../helpers/inMemoryFirestore';

void describe('Event Recording Integration', () => {
  void it('records appended events in the given Firestore', async () => {
    const firestore = createInMemoryFirestore();
    const database = createInMemoryDatabase();

    const eventStore = createEventStore({ firestore, database });

    await eventStore.appendToStream('stream-1', [
      { type: 'TestEvent', data: { value: 1 } },
    ]);

    const events = await firestore
      .collection('streams')
      .doc('stream-1')
      .collection('events')
      .get();

    assert.equal(events.size, 1);
  });
});
