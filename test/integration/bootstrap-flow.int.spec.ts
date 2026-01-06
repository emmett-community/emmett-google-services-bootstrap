import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ServiceBootstrap } from '../../src/bootstrap/ServiceBootstrap';
import { createInMemoryFirestore } from '../helpers/inMemoryFirestore';
import { createInMemoryDatabase } from '../helpers/inMemoryDatabase';
import { createInMemoryPubSub } from '../helpers/inMemoryPubSub';
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import type { MessageBusWithLifecycle } from '../../src/types/config';

void describe('Bootstrap Integration Flow', () => {
  void it('initializes overrides and runs custom dependencies', async () => {
    const firestore = createInMemoryFirestore();
    const database = createInMemoryDatabase();
    const auth = {} as any;
    const pubsub = createInMemoryPubSub();
    const eventStore = getInMemoryEventStore();
    const app = {
      firestore: () => firestore,
      database: () => database,
      auth: () => auth,
      delete: mock.fn(),
    };

    const firebaseAdmin = {
      apps: [],
      initializeApp: mock.fn(() => app),
      app: mock.fn(() => app),
    };

    const messageBus: MessageBusWithLifecycle = {
      start: mock.fn(async () => {}),
      close: mock.fn(async () => {}),
    } as unknown as MessageBusWithLifecycle;

    let dependencyCalled = false;

    const bootstrap = new ServiceBootstrap({
      serviceName: 'test-service',
      firebase: { projectId: 'test-project' },
      pubsub: { projectId: 'test-project' },
      includeDefaultDependencyChecks: false,
      dependencies: [
        {
          name: 'custom',
          check: async () => {
            dependencyCalled = true;
          },
        },
      ],
      _testOverrides: {
        firebaseAdmin,
        firestore,
        database,
        auth,
        pubsub,
        eventStore,
        messageBus,
      },
    });

    const ctx = await bootstrap.initialize();
    await bootstrap.start();

    assert.equal(ctx.firestore, firestore);
    assert.equal(ctx.database, database);
    assert.equal(ctx.pubsub, pubsub);
    assert.equal(ctx.eventStore, eventStore);
    assert.equal(ctx.messageBus, messageBus);
    assert.equal(dependencyCalled, true);
  });
});
