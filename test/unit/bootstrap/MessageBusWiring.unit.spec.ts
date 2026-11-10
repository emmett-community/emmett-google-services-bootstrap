import type { FirebaseAdminLike } from '../../../src/types/config';
import type { Auth } from 'firebase-admin/auth';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { InMemoryPubSub } from '@emmett-community/emmett-google-pubsub/testing';
import type { PubSub } from '@google-cloud/pubsub';
import { ServiceBootstrap } from '../../../src/bootstrap/ServiceBootstrap';
import type { Logger, ServiceBootstrapConfig } from '../../../src/types/config';
import { restoreEnv } from '../../helpers/env';
import { createInMemoryDatabase } from '../../helpers/inMemoryDatabase';
import { createInMemoryFirestore } from '../../helpers/inMemoryFirestore';

type LogRecord = {
  level: string;
  context: Record<string, unknown>;
  message?: string;
};

const createCapturingLogger = () => {
  const records: LogRecord[] = [];
  const record =
    (level: string) =>
    (context: Record<string, unknown>, message?: string): void => {
      records.push({ level, context, message });
    };

  const logger: Logger = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
  };

  return { logger, records };
};

const createBootstrap = (
  pubsub: InMemoryPubSub,
  config: Partial<ServiceBootstrapConfig> = {},
) => {
  const firestore = createInMemoryFirestore();
  const database = createInMemoryDatabase();
  const auth = {} as Auth;
  const app = {
    firestore: () => firestore,
    database: () => database,
    auth: () => auth,
    delete: async () => {},
  };

  return new ServiceBootstrap({
    serviceName: 'orders',
    firebase: { projectId: 'test-project' },
    pubsub: {
      projectId: 'test-project',
      emulatorHost: 'localhost:8085',
      subscriptionOptions: { watchdog: { enabled: false } },
      ...config.pubsub,
    },
    includeDefaultDependencyChecks: false,
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
      pubsub: pubsub as unknown as PubSub,
    },
  });
};

const subscriptionExists = async (
  pubsub: InMemoryPubSub,
  topic: string,
  subscription: string,
): Promise<boolean> => {
  const [exists] = await pubsub
    .topic(topic)
    .subscription(subscription)
    .exists();
  return exists;
};

void describe('ServiceBootstrap message bus wiring - unit', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  void it('names event subscriptions after the service, so replicas share them', async () => {
    const pubsub = new InMemoryPubSub();
    const ctx = await createBootstrap(pubsub).initialize();

    ctx.messageBus.subscribe(async () => {}, 'OrderCreated');
    await ctx.messageBus.start();

    assert.equal(
      await subscriptionExists(
        pubsub,
        'orders-evt-OrderCreated',
        'orders-evt-OrderCreated-orders',
      ),
      true,
    );

    await ctx.messageBus.close();
  });

  void it('names command subscriptions after the service, so a command has one handler', async () => {
    const pubsub = new InMemoryPubSub();
    const ctx = await createBootstrap(pubsub).initialize();

    ctx.messageBus.handle(async () => {}, 'CreateOrder');
    await ctx.messageBus.start();

    assert.equal(
      await subscriptionExists(
        pubsub,
        'orders-cmd-CreateOrder',
        'orders-cmd-CreateOrder-orders',
      ),
      true,
    );

    await ctx.messageBus.close();
  });

  void it('uses the configured subscription id instead of the service name', async () => {
    const pubsub = new InMemoryPubSub();
    const ctx = await createBootstrap(pubsub, {
      pubsub: { subscriptionId: 'orders-worker' },
    }).initialize();

    ctx.messageBus.subscribe(async () => {}, 'OrderCreated');
    await ctx.messageBus.start();

    assert.equal(ctx.config.pubsub.subscriptionId, 'orders-worker');
    assert.equal(
      await subscriptionExists(
        pubsub,
        'orders-evt-OrderCreated',
        'orders-evt-OrderCreated-orders-worker',
      ),
      true,
    );

    await ctx.messageBus.close();
  });

  void it('reads the topic prefix from PUBSUB_TOPIC_PREFIX', async () => {
    process.env.PUBSUB_TOPIC_PREFIX = 'stg';
    const pubsub = new InMemoryPubSub();
    const ctx = await createBootstrap(pubsub).initialize();

    ctx.messageBus.subscribe(async () => {}, 'OrderCreated');
    await ctx.messageBus.start();

    assert.equal(ctx.config.pubsub.topicPrefix, 'stg');
    assert.equal(
      await subscriptionExists(
        pubsub,
        'stg-evt-OrderCreated',
        'stg-evt-OrderCreated-orders',
      ),
      true,
    );

    await ctx.messageBus.close();
  });

  void it('prefers the configured topic prefix over PUBSUB_TOPIC_PREFIX', () => {
    process.env.PUBSUB_TOPIC_PREFIX = 'stg';

    const config = createBootstrap(new InMemoryPubSub(), {
      pubsub: { topicPrefix: 'custom' },
    }).getConfig();

    assert.equal(config.pubsub.topicPrefix, 'custom');
  });

  void it('defaults the topic prefix to the service name', () => {
    delete process.env.PUBSUB_TOPIC_PREFIX;

    const config = createBootstrap(new InMemoryPubSub()).getConfig();

    assert.equal(config.pubsub.topicPrefix, 'orders');
  });

  void it('passes the logger to the message bus as is, in (context, message) form', async () => {
    const pubsub = new InMemoryPubSub();
    const { logger, records } = createCapturingLogger();
    const ctx = await createBootstrap(pubsub, {
      observability: { logger },
    }).initialize();

    await ctx.messageBus.start();

    const started = records.find(
      (record) => record.message === 'Starting message bus',
    );
    assert.ok(started, 'the message bus start is logged');
    assert.equal(started.level, 'info');
    assert.equal(typeof started.context, 'object');

    await ctx.messageBus.close();
  });

  void it('logs message bus errors with the Error under the err key', async () => {
    const pubsub = new InMemoryPubSub();
    const failure = new Error('publish failed');
    pubsub.topic('orders-evt-OrderCreated').publishMessage = () =>
      Promise.reject(failure);

    const { logger, records } = createCapturingLogger();
    const ctx = await createBootstrap(pubsub, {
      observability: { logger },
    }).initialize();

    await assert.rejects(() =>
      ctx.messageBus.publish({ type: 'OrderCreated', data: {} }),
    );

    const error = records.find((record) => record.level === 'error');
    assert.ok(error, 'the publish failure is logged');
    assert.equal(error.message, 'Failed to publish message');
    assert.equal(error.context.err, failure);
  });

  const publishOptionsOf = async (
    config: Partial<ServiceBootstrapConfig> = {},
  ) => {
    const pubsub = new InMemoryPubSub();
    const topic = pubsub.topic.bind(pubsub);
    const options: unknown[] = [];
    pubsub.topic = (name: string, publishOptions?: unknown) => {
      if (name === 'orders-evt-OrderCreated') options.push(publishOptions);
      return topic(name);
    };
    const ctx = await createBootstrap(pubsub, config).initialize();

    await ctx.messageBus.publish({ type: 'OrderCreated', data: {} });
    await ctx.messageBus.close();
    return options;
  };

  void it('limits each client call of a publication to 10 seconds by default', async () => {
    assert.deepEqual(await publishOptionsOf(), [
      { gaxOpts: { timeout: 10000 } },
    ]);
  });

  void it('uses the configured publish timeout', async () => {
    assert.deepEqual(
      await publishOptionsOf({ pubsub: { publishTimeoutMs: 2000 } }),
      [{ gaxOpts: { timeout: 2000 } }],
    );
  });
});
