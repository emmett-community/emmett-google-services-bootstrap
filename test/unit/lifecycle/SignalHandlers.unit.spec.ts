import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { registerSignalHandlers } from '../../../src/lifecycle/SignalHandlers';

void describe('SignalHandlers - unit', () => {
  void it('registers and unregisters signal handlers', () => {
    const originalOn = process.on;
    const originalOff = process.off;
    const handlers = new Map<NodeJS.Signals, () => void>();

    const onMock = mock.fn((signal: NodeJS.Signals, handler: () => void) => {
      handlers.set(signal, handler);
      return process;
    });

    const offMock = mock.fn((signal: NodeJS.Signals, handler: () => void) => {
      handlers.delete(signal);
      return process;
    });

    process.on = onMock as unknown as typeof process.on;
    process.off = offMock as unknown as typeof process.off;

    try {
      const shutdown = mock.fn();
      const unregister = registerSignalHandlers({
        shutdown,
        signals: ['SIGINT', 'SIGTERM'],
      });

      const sigintHandler = handlers.get('SIGINT');
      assert.ok(sigintHandler);

      sigintHandler?.();

      assert.equal(shutdown.mock.callCount(), 1);

      unregister();

      assert.equal(offMock.mock.callCount(), 2);
    } finally {
      process.on = originalOn;
      process.off = originalOff;
    }
  });
});
