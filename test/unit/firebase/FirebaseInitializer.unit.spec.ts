import assert from 'node:assert/strict';
import { describe, it, afterEach, mock } from 'node:test';
import { FirebaseInitializer } from '../../../src/firebase/FirebaseInitializer';
import { restoreEnv } from '../../helpers/env';

void describe('FirebaseInitializer - unit', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  void it('initializes Firebase with emulator settings', async () => {
    const firestore = { settings: mock.fn() };
    const database = {};
    const auth = {};
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

    const initializer = new FirebaseInitializer({
      projectId: 'test-project',
      databaseEmulatorHost: 'localhost:9000',
      firestoreEmulatorHost: 'localhost:8080',
      _firebaseAdmin: firebaseAdmin,
    });

    const result = await initializer.initialize();

    assert.equal(firebaseAdmin.initializeApp.mock.callCount(), 1);
    assert.deepEqual(firebaseAdmin.initializeApp.mock.calls[0].arguments[0], {
      projectId: 'test-project',
      databaseURL: 'http://localhost:9000?ns=test-project',
    });
    assert.equal(result.firestore, firestore);
    assert.equal(result.database, database);
    assert.equal(result.auth, auth);
    assert.equal(firestore.settings.mock.callCount(), 1);
  });

  void it('reuses existing app when available', async () => {
    const firestore = { settings: mock.fn() };
    const database = {};
    const auth = {};
    const app = {
      firestore: () => firestore,
      database: () => database,
      auth: () => auth,
      delete: mock.fn(),
    };

    const firebaseAdmin = {
      apps: [app],
      initializeApp: mock.fn(() => app),
      app: mock.fn(() => app),
    };

    const initializer = new FirebaseInitializer({
      projectId: 'test-project',
      _firebaseAdmin: firebaseAdmin,
    });

    await initializer.initialize();

    assert.equal(firebaseAdmin.initializeApp.mock.callCount(), 0);
    assert.equal(firebaseAdmin.app.mock.callCount(), 1);
  });

  void it('detects emulator mode from environment', () => {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';

    const initializer = new FirebaseInitializer({
      projectId: 'test-project',
    });

    assert.equal(initializer.isEmulatorMode(), true);
  });
});
