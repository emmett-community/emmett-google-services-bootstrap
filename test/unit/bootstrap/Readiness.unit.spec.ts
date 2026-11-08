import type { Request, RequestHandler, Response } from 'express';
import type { Database } from 'firebase-admin/database';
import type { FirebaseAdminLike } from '../../../src/types/config';
import type { Auth } from 'firebase-admin/auth';
import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { getHealth, getReady } from '../../../src/bootstrap/probes';
import { ServiceBootstrap } from '../../../src/bootstrap/ServiceBootstrap';
import type {
  MessageBusWithLifecycle,
  ServiceBootstrapConfig,
} from '../../../src/types/config';
import { createInMemoryDatabase } from '../../helpers/inMemoryDatabase';
import { createInMemoryFirestore } from '../../helpers/inMemoryFirestore';
import { createInMemoryPubSub } from '../../helpers/inMemoryPubSub';

const createBootstrap = (
  config: Partial<ServiceBootstrapConfig> = {},
  options: { started?: boolean; database?: Database } = {},
) => {
  const firestore = createInMemoryFirestore();
  const database = options.database ?? createInMemoryDatabase();
  const auth = {} as Auth;
  const app = {
    firestore: () => firestore,
    database: () => database,
    auth: () => auth,
    delete: async () => {},
  };

  const messageBus = {
    start: mock.fn(async () => {}),
    close: mock.fn(async () => {}),
    isStarted: () => options.started ?? true,
  } as unknown as MessageBusWithLifecycle;

  return new ServiceBootstrap({
    serviceName: 'orders',
    firebase: { projectId: 'test-project' },
    pubsub: { projectId: 'test-project' },
    observability: { createLogger: false },
    ...config,
    _testOverrides: {
      firebaseAdmin: {
        apps: [],
        initializeApp: () => app,
        app: () => app,
      } as unknown as FirebaseAdminLike,
      firestore,
      database,
      auth,
      pubsub: createInMemoryPubSub(),
      messageBus,
    },
  });
};

const names = (summary: { results: Array<{ name: string }> }) =>
  summary.results.map((result) => result.name);

const callHandler = async (
  handler: (...args: Parameters<RequestHandler>) => unknown,
) => {
  const response: { status?: number; body?: unknown } = {};
  const res = {
    statusCode: 200,
    setHeader() {
      return res;
    },
    send(body: unknown) {
      response.status = res.statusCode;
      response.body = body;
      return res;
    },
    sendStatus(code: number) {
      response.status = code;
      return res;
    },
  };

  await Promise.resolve(
    handler({} as Request, res as unknown as Response, () => {}),
  );

  return response;
};

void describe('ServiceBootstrap readiness - unit', () => {
  void it('checks the stores and the message bus', async () => {
    const summary = await createBootstrap().checkReadiness();

    assert.equal(summary.ok, true);
    assert.deepEqual(names(summary), [
      'Firestore',
      'Realtime Database',
      'PubSub',
    ]);
  });

  void it('fails when the message bus is not started', async () => {
    const summary = await createBootstrap(
      {},
      { started: false },
    ).checkReadiness();

    assert.equal(summary.ok, false);
    assert.deepEqual(
      summary.results
        .filter((result) => !result.ok)
        .map((result) => result.name),
      ['PubSub'],
    );
  });

  void it('skips the Realtime Database check when the service does not use it', async () => {
    const bootstrap = createBootstrap({ includeRealtimeDatabaseCheck: false });

    const summary = await bootstrap.checkReadiness();
    assert.deepEqual(names(summary), ['Firestore', 'PubSub']);

    const startup = await bootstrap.start();
    assert.ok(startup);
    assert.equal(bootstrap.getConfig().includeRealtimeDatabaseCheck, false);
  });

  void it('checks the Realtime Database by default', () => {
    assert.equal(
      createBootstrap().getConfig().includeRealtimeDatabaseCheck,
      true,
    );
  });

  void it('includes the configured dependencies and fails with them', async () => {
    const summary = await createBootstrap({
      dependencies: [
        {
          name: 'billing',
          check: () => Promise.reject(new Error('billing down')),
        },
      ],
    }).checkReadiness();

    assert.equal(summary.ok, false);
    assert.deepEqual(names(summary), [
      'Firestore',
      'Realtime Database',
      'PubSub',
      'billing',
    ]);
  });

  void it('fails a check that hangs instead of hanging the probe', async () => {
    const summary = await createBootstrap({
      includeDefaultDependencyChecks: false,
      dependencies: [
        {
          name: 'slow',
          timeoutMs: 20,
          check: () => new Promise<void>(() => {}),
        },
      ],
    }).checkReadiness();

    assert.equal(summary.ok, false);
    assert.equal(summary.results[0].timedOut, true);
  });
});

void describe('probe handlers - unit', () => {
  void it('answers /health with 200', async () => {
    const response = await callHandler(getHealth);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'ok' });
  });

  void it('answers /ready with 200 and the checks when ready', async () => {
    const ctx = await createBootstrap().initialize();

    const response = await callHandler(getReady(ctx));

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: 'ready',
      checks: [
        { name: 'Firestore', ok: true },
        { name: 'Realtime Database', ok: true },
        { name: 'PubSub', ok: true },
      ],
    });
  });

  void it('answers /ready with 503 and the failed checks when not ready', async () => {
    const ctx = await createBootstrap({}, { started: false }).initialize();

    const response = await callHandler(getReady(ctx));

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      status: 'unavailable',
      checks: [
        { name: 'Firestore', ok: true },
        { name: 'Realtime Database', ok: true },
        { name: 'PubSub', ok: false },
      ],
    });
  });
});
