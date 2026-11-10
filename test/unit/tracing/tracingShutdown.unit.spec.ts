import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { createTestServiceBootstrap } from '../../../src/testing';
import {
  TRACING_SHUTDOWN,
  setTracingShutdown,
} from '../../../src/tracing/shutdown';

void describe('Tracing on shutdown - unit', () => {
  afterEach(() => {
    delete (globalThis as { [TRACING_SHUTDOWN]?: unknown })[TRACING_SHUTDOWN];
  });

  void it('flushes the spans when the bootstrap shuts down, after the other tasks', async () => {
    const calls: string[] = [];
    setTracingShutdown(() => {
      calls.push('tracing');
      return Promise.resolve();
    });
    const { bootstrap } = createTestServiceBootstrap({ serviceName: 'orders' });
    await bootstrap.initialize();

    const result = await bootstrap.shutdown('test', 0);

    assert.deepEqual(calls, ['tracing']);
    const names = result.tasks.map((task) => task.name);
    assert.equal(names[names.length - 1], 'tracing');
  });

  void it('has no tracing task when tracing was not started', async () => {
    const { bootstrap } = createTestServiceBootstrap({ serviceName: 'orders' });
    await bootstrap.initialize();

    const result = await bootstrap.shutdown('test', 0);

    assert.equal(
      result.tasks.some((task) => task.name === 'tracing'),
      false,
    );
  });
});
