import assert from 'node:assert/strict';
import { describe, it, afterEach, mock } from 'node:test';
import { ServiceBootstrap, DependencyUnavailableError } from '../../../src/bootstrap/ServiceBootstrap';
import { createInMemoryFirestore } from '../../helpers/inMemoryFirestore';
import { createInMemoryDatabase } from '../../helpers/inMemoryDatabase';
import { createInMemoryPubSub } from '../../helpers/inMemoryPubSub';
import { getInMemoryEventStore } from '@event-driven-io/emmett';
import type { MessageBusWithLifecycle } from '../../../src/types/config';
import { restoreEnv } from '../../helpers/env';

void describe('ServiceBootstrap - unit', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  void it('initializes with overrides', async () => {
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

    const ctx = await bootstrap.initialize();

    assert.equal(ctx.firestore, firestore);
    assert.equal(ctx.database, database);
    assert.equal(ctx.pubsub, pubsub);
    assert.equal(ctx.eventStore, eventStore);
    assert.equal(ctx.messageBus, messageBus);
  });

  void it('throws when required config is missing', () => {
    delete process.env.FIRESTORE_PROJECT_ID;
    delete process.env.PUBSUB_PROJECT_ID;
    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;

    const bootstrap = new ServiceBootstrap({
      serviceName: '',
    } as any);

    assert.throws(() => bootstrap.getConfig(), /Missing required configuration/);
  });

  void it('fails startup when dependency check fails', async () => {
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

    const bootstrap = new ServiceBootstrap({
      serviceName: 'test-service',
      firebase: { projectId: 'test-project' },
      pubsub: { projectId: 'test-project' },
      includeDefaultDependencyChecks: false,
      shutdownOnDependencyFailure: false,
      dependencies: [
        {
          name: 'failing',
          check: async () => {
            throw new Error('dependency down');
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

    await assert.rejects(() => bootstrap.start(), DependencyUnavailableError);
  });
});
