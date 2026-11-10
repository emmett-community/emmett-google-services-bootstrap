import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createInternalAuthHandler,
  internalAuthOptionsFromEnvironment,
} from '../../../src';

void describe('Internal authentication re-exported by the bootstrap - unit', () => {
  void it('accepts a verified token of an allowed caller', async () => {
    const handler = createInternalAuthHandler({
      allowedCallers: ['scheduler@project.iam.gserviceaccount.com'],
      audience: 'https://orders-service.example.run.app',
      verifier: {
        verifyIdToken: () =>
          Promise.resolve({
            getPayload: () => ({
              email: 'scheduler@project.iam.gserviceaccount.com',
              email_verified: true,
            }),
          }),
      },
    });

    assert.equal(
      await handler({ headers: { authorization: 'Bearer token' } }),
      true,
    );
  });

  void it('reads the options from the environment', () => {
    const options = internalAuthOptionsFromEnvironment({
      INTERNAL_ALLOWED_CALLERS: 'scheduler@project.iam.gserviceaccount.com',
      INTERNAL_AUDIENCE: 'https://orders-service.example.run.app',
    });

    assert.deepEqual(options.allowedCallers, [
      'scheduler@project.iam.gserviceaccount.com',
    ]);
    assert.equal(options.skip, false);
  });
});
