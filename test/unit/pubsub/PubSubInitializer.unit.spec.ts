import assert from 'node:assert/strict';
import { describe, it, afterEach, mock } from 'node:test';
import { PubSubInitializer } from '../../../src/pubsub/PubSubInitializer';
import { restoreEnv } from '../../helpers/env';

void describe('PubSubInitializer - unit', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  void it('uses provided PubSub client', async () => {
    const pubsub = { close: mock.fn() } as any;

    const initializer = new PubSubInitializer({
      projectId: 'test-project',
      emulatorHost: 'localhost:8085',
      _pubsub: pubsub,
    });

    const result = await initializer.initialize();

    assert.equal(result, pubsub);
    assert.equal(process.env.PUBSUB_EMULATOR_HOST, 'localhost:8085');
  });

  void it('detects emulator mode from environment', () => {
    process.env.PUBSUB_EMULATOR_HOST = 'localhost:8085';

    const initializer = new PubSubInitializer({
      projectId: 'test-project',
    });

    assert.equal(initializer.isEmulatorMode(), true);
  });
});
