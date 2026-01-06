import assert from 'node:assert/strict';
import path from 'node:path';
import { before, beforeEach, after, describe, it } from 'node:test';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { ServiceBootstrap } from '../../src/bootstrap/ServiceBootstrap';
import { restoreEnv } from '../helpers/env';

const projectId = 'demo-project';

let emulator: StartedTestContainer | null = null;
let emulatorHost = '';
let firestorePort = 0;
let databasePort = 0;
let pubsubPort = 0;
let bootstrap: ServiceBootstrap | undefined;

const startEmulator = async () => {
  const container = await new GenericContainer('myfstartup/firebase-emulator-suite:15')
    .withPlatform('linux/amd64')
    .withExposedPorts(4000, 9099, 8080, 9000, 8085)
    .withBindMounts([
      {
        source: path.join(process.cwd(), 'test', 'firebase', 'firebase.json'),
        target: '/app/firebase.json',
        mode: 'ro' as const,
      },
      {
        source: path.join(process.cwd(), 'test', 'firebase', '.firebaserc'),
        target: '/app/.firebaserc',
        mode: 'ro' as const,
      },
    ])
    .withEnvironment({ PROJECT_ID: projectId })
    .withWaitStrategy(Wait.forHttp('/', 4000).withStartupTimeout(120000))
    .start();

  emulatorHost = container.getHost();
  firestorePort = container.getMappedPort(8080);
  databasePort = container.getMappedPort(9000);
  pubsubPort = container.getMappedPort(8085);

  process.env.FIRESTORE_EMULATOR_HOST = `${emulatorHost}:${firestorePort}`;
  process.env.FIREBASE_DATABASE_EMULATOR_HOST = `${emulatorHost}:${databasePort}`;
  process.env.PUBSUB_EMULATOR_HOST = `${emulatorHost}:${pubsubPort}`;
  process.env.GCLOUD_PROJECT = projectId;
  process.env.FIRESTORE_PROJECT_ID = projectId;
  process.env.PUBSUB_PROJECT_ID = projectId;

  return container;
};

const resetFirestore = async () => {
  const res = await fetch(
    `http://${emulatorHost}:${firestorePort}/emulator/v1/projects/${projectId}/databases/(default)/documents`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    throw new Error(`Failed to reset Firestore emulator: ${res.status} ${res.statusText}`);
  }
};

const resetDatabase = async () => {
  const res = await fetch(
    `http://${emulatorHost}:${databasePort}/.json?ns=${projectId}`,
    { method: 'DELETE' },
  );

  if (!res.ok) {
    throw new Error(`Failed to reset database emulator: ${res.status} ${res.statusText}`);
  }
};

void describe('Event Store E2E', () => {
  const originalEnv = { ...process.env };

  before(async () => {
    emulator = await startEmulator();
  });

  beforeEach(async () => {
    await resetFirestore();
    await resetDatabase();

    bootstrap = new ServiceBootstrap({
      serviceName: 'e2e-event-store',
    });
  });

  after(async () => {
    if (bootstrap) {
      await bootstrap.shutdown('test cleanup', 0);
    }
    if (emulator) {
      await emulator.stop();
    }
    restoreEnv(originalEnv);
  });

  void it('persists events to Firestore emulator', async () => {
    const ctx = await bootstrap!.initialize();

    await ctx.eventStore.appendToStream('test-stream-1', [
      { type: 'TestEventOccurred', data: { value: 'test' } },
    ]);

    const events = await ctx.eventStore.readStream('test-stream-1');

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, 'TestEventOccurred');
  });
});
