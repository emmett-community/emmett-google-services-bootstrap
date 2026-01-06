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
      close: async () => {
        calls.push('first');
      },
    });

    shutdown.register({
      name: 'second',
      close: async () => {
        calls.push('second');
      },
    });

    const result = await shutdown.shutdown('test', 1);

    assert.deepEqual(calls, ['first', 'second']);
    assert.equal(result.exitCode, 0);
    assert.equal(exitCode, 0);
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
      close: async () => {
        throw new Error('boom');
      },
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
