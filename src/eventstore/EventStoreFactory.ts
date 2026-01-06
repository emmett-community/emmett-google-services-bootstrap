import { getFirestoreEventStore } from '@emmett-community/emmett-google-firestore';
import {
  wireRealtimeDBProjections,
  type RealtimeDBInlineProjectionDefinition,
} from '@emmett-community/emmett-google-realtime-db';
import type { EventStore } from '@event-driven-io/emmett';
import type { Firestore } from '@google-cloud/firestore';
import type { Database } from 'firebase-admin/database';
import type { Logger } from '../types/config';

export type EventStoreFactoryOptions = {
  firestore: Firestore;
  database: Database;
  projections?: RealtimeDBInlineProjectionDefinition[];
  logger?: Logger;
};

/**
 * Create a Firestore-backed event store and wire RealtimeDB projections if provided.
 */
export const createEventStore = <T extends EventStore = EventStore>(
  options: EventStoreFactoryOptions,
): T => {
  const { firestore, database, projections, logger } = options;
  const observability = logger ? { logger } : undefined;

  const baseEventStore = getFirestoreEventStore(firestore, { observability });

  if (projections && projections.length > 0) {
    return wireRealtimeDBProjections({
      eventStore: baseEventStore as unknown as T,
      database,
      projections,
      observability,
    }) as T;
  }

  return baseEventStore as unknown as T;
};
