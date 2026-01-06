import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ServiceBootstrap } from '../../src/bootstrap/ServiceBootstrap';
import { createInMemoryFirestore } from '../helpers/inMemoryFirestore';
import { createInMemoryDatabase } from '../helpers/inMemoryDatabase';
import { createInMemoryPubSub } from '../helpers/inMemoryPubSub';
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import type { MessageBusWithLifecycle } from '../../src/types/config';

void describe('Shutdown Integration Flow', () => {
  void it('runs registered shutdown tasks', async () => {
    const firestore = createInMemoryFirestore();
    const terminate = mock.fn(async () => {});
    (firestore as any).terminate = terminate;

    const database = createInMemoryDatabase();
    const auth = {} as any;
    const pubsub = createInMemoryPubSub();
    const eventStore = getInMemoryEventStore();

    const deleteApp = mock.fn(async () => {});
    const app = {
      firestore: () => firestore,
      database: () => database,
      auth: () => auth,
      delete: deleteApp,
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

    const bootstrap = new ServiceBootstrap({
      serviceName: 'test-service',
      firebase: { projectId: 'test-project' },
      pubsub: { projectId: 'test-project' },
      includeDefaultDependencyChecks: false,
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

    await bootstrap.initialize();
    const result = await bootstrap.shutdown('test', 0);

    assert.equal(result.exitCode, 0);
    assert.equal(messageBus.close.mock.callCount(), 1);
    assert.equal(terminate.mock.callCount(), 1);
    assert.equal(deleteApp.mock.callCount(), 1);
  });
});
