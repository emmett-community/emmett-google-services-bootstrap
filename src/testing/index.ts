// Test support: import from '@emmett-community/emmett-google-services-bootstrap/testing'
import { InMemoryFirestore } from '@emmett-community/emmett-google-firestore/testing';
import { createInMemoryMessageBus } from '@emmett-community/emmett-google-pubsub/testing';
import { createInMemoryDatabase } from '@emmett-community/emmett-google-realtime-db/testing';
import type { Firestore } from '@google-cloud/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { Database } from 'firebase-admin/database';
import { ServiceBootstrap } from '../bootstrap/ServiceBootstrap';
import type {
  MessageBusWithLifecycle,
  ServiceBootstrapConfig,
  ServiceBootstrapOverrides,
} from '../types/config';

export type TestServiceBootstrapOptions = Omit<
  ServiceBootstrapConfig,
  '_testOverrides'
> & {
  /** Replace any of the in-memory pieces, for example to share one `pubsub` between two services. */
  overrides?: ServiceBootstrapOverrides;
};

export type TestServiceBootstrap = {
  bootstrap: ServiceBootstrap;
  firestore: Firestore;
  database: Database;
  messageBus: MessageBusWithLifecycle;
};

/**
 * Service bootstrap on in-memory Firestore, Realtime Database and Pub/Sub, with no Firebase
 * app, no emulator and no network. The event store, the projections and the message bus are
 * the real ones, wired to the fakes, so a service test exercises the same code as production.
 */
export const createTestServiceBootstrap = (
  options: TestServiceBootstrapOptions,
): TestServiceBootstrap => {
  const { overrides, ...config } = options;

  const firestore =
    overrides?.firestore ?? (new InMemoryFirestore() as unknown as Firestore);
  const database = overrides?.database ?? createInMemoryDatabase();
  const auth = overrides?.auth ?? ({} as Auth);

  const app = {
    firestore: () => firestore,
    database: () => database,
    auth: () => auth,
    delete: async () => {},
  };

  const firebaseAdmin = overrides?.firebaseAdmin ?? {
    apps: [],
    initializeApp: () => app,
    app: () => app,
  };

  const messageBus = (overrides?.messageBus ??
    createInMemoryMessageBus({
      subscriptionId: config.pubsub?.subscriptionId ?? config.serviceName,
      instanceId: config.pubsub?.subscriptionId ?? config.serviceName,
    })) as MessageBusWithLifecycle;

  const bootstrap = new ServiceBootstrap({
    ...config,
    firebase: { projectId: 'test-project', ...config.firebase },
    pubsub: { projectId: 'test-project', ...config.pubsub },
    observability: { createLogger: false, ...config.observability },
    _testOverrides: {
      ...overrides,
      firebaseAdmin:
        firebaseAdmin as ServiceBootstrapOverrides['firebaseAdmin'],
      firestore,
      database,
      auth,
      messageBus,
    },
  });

  return { bootstrap, firestore, database, messageBus };
};
