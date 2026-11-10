import type { FirestoreEventStoreHooks } from '@emmett-community/emmett-google-firestore';
import type { Event, EventStore } from '@event-driven-io/emmett';
import type { Firestore } from '@google-cloud/firestore';
import {
  createFirestoreOutbox,
  type Outbox,
  type OutboxMessage,
} from '@my-f-startup/google-firestore-outbox';
import type {
  Logger,
  MessageBusWithLifecycle,
  ResolvedOutboxConfig,
} from '../types/config';

export type ServiceOutboxOptions = {
  firestore: Firestore;
  messageBus: MessageBusWithLifecycle;
  config: ResolvedOutboxConfig;
  logger?: Logger;
};

/**
 * Outbox whose messages are published as events on the message bus, keeping their `messageId`.
 */
export const createServiceOutbox = (options: ServiceOutboxOptions): Outbox => {
  const { firestore, messageBus, config, logger } = options;

  return createFirestoreOutbox({
    ...config,
    firestore,
    logger,
    publish: (message: OutboxMessage) =>
      messageBus.publish({
        type: message.type,
        data: message.data,
        metadata: { ...message.metadata, messageId: message.messageId },
      } as Event),
  });
};

/**
 * Store hooks that record the appended events in the outbox, in the transaction of the append,
 * and then run the hooks given in the configuration.
 */
export const withOutboxRecord = (
  outbox: Outbox,
  hooks?: FirestoreEventStoreHooks,
): FirestoreEventStoreHooks => ({
  beforeCommit: async (transaction, events) => {
    outbox.record(transaction, events);
    await hooks?.beforeCommit?.(transaction, events);
  },
});

/**
 * Event store that publishes the appended events through the outbox once the append committed.
 * The publication never fails the append: what is not published stays in the outbox.
 */
export const withPublishAfterCommit = <T extends EventStore>(
  eventStore: T,
  outbox: Outbox,
): T => {
  const appendToStream: EventStore['appendToStream'] = async (
    streamName,
    events,
    options,
  ) => {
    const result = await eventStore.appendToStream(streamName, events, options);
    const { messageIds } = result as unknown as { messageIds?: string[] };

    if (messageIds && messageIds.length === events.length) {
      await outbox.publishCommitted(
        events.map((event, index) => ({
          messageId: messageIds[index],
          type: event.type,
          data: event.data,
          metadata: (event as { metadata?: Record<string, unknown> }).metadata,
        })),
      );
    }

    return result;
  };

  return new Proxy(eventStore, {
    get(target, property) {
      if (property === 'appendToStream') {
        return appendToStream;
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
};
