import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GracefulShutdown } from '../../../src/lifecycle/GracefulShutdown';

void describe('GracefulShutdown - unit', () => {
  void it('runs shutdown tasks in order', async () => {
    const calls: string[] = [];
    let exitCode: number | undefined;

    const shutdown = new GracefulShutdown({
      exitOnComplete: true,
      exitFn: (code) => {
        exitCode = code;
      },
    });

    shutdown.register({
      name: 'first',
      close: () => {
        calls.push('first');
        return Promise.resolve();
      },
    });

    shutdown.register({
      name: 'second',
      close: () => {
        calls.push('second');
        return Promise.resolve();
      },
    });

    const result = await shutdown.shutdown('test', 1);

    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(result.exitCode, 0);
    assert.equal(exitCode, 0);
  });

  void it('runs a task registered first before the ones already registered', async () => {
    const calls: string[] = [];
    const shutdown = new GracefulShutdown();

    shutdown.register({
      name: 'messageBus',
      close: () => {
        calls.push('messageBus');
        return Promise.resolve();
      },
    });

    shutdown.register({
      name: 'firestore',
      close: () => {
        calls.push('firestore');
        return Promise.resolve();
      },
    });

    shutdown.registerFirst({
      name: 'httpServer',
      close: () => {
        calls.push('httpServer');
        return Promise.resolve();
      },
    });

    await shutdown.shutdown('test', 1);

    assert.deepEqual(calls, ['httpServer', 'messageBus', 'firestore']);
  });

  void it('propagates failures and uses provided exit code', async () => {
    let exitCode: number | undefined;

    const shutdown = new GracefulShutdown({
      exitOnComplete: true,
      exitFn: (code) => {
        exitCode = code;
      },
    });

    shutdown.register({
      name: 'fail',
      close: () => Promise.reject(new Error('boom')),
    });

    const result = await shutdown.shutdown('test', 2);

    assert.equal(result.exitCode, 2);
    assert.equal(exitCode, 2);
    assert.equal(result.tasks[0]?.ok, false);
  });

  void it('returns cached result on repeated shutdown', async () => {
    const shutdown = new GracefulShutdown();

    shutdown.register({
      name: 'noop',
      close: async () => {},
    });

    const first = await shutdown.shutdown('test');
    const second = await shutdown.shutdown('test');

    assert.equal(first, second);
  });
});
