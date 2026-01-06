import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DependencyChecker,
  DependencyTimeoutError,
  startDependency,
} from '../../../src/lifecycle/DependencyChecker';

void describe('DependencyChecker - unit', () => {
  void it('reports successful checks', async () => {
    const checker = new DependencyChecker();

    const result = await checker.check({
      name: 'success',
      check: async () => {},
    });

    assert.equal(result.ok, true);
    assert.equal(result.timedOut, false);
  });

  void it('reports failures', async () => {
    const checker = new DependencyChecker();

    const result = await checker.check({
      name: 'failure',
      check: async () => {
        throw new Error('boom');
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, false);
    assert.ok(result.error);
  });

  void it('reports timeouts', async () => {
    const checker = new DependencyChecker();

    const result = await checker.check({
      name: 'timeout',
      check: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      timeoutMs: 10,
    });

    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.ok(result.error instanceof DependencyTimeoutError);
  });

  void it('aggregates checks', async () => {
    const checker = new DependencyChecker();

    const summary = await checker.checkAll([
      { name: 'one', check: async () => {} },
      {
        name: 'optional',
        check: async () => {
          throw new Error('optional failed');
        },
        required: false,
      },
    ]);

    assert.equal(summary.ok, true);
    assert.equal(summary.results.length, 2);
  });

  void it('startDependency returns false on failure', async () => {
    const ok = await startDependency('dependency', async () => {
      throw new Error('fail');
    });

    assert.equal(ok, false);
  });
});
