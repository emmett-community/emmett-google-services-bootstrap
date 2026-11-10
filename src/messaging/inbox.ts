import type { Firestore } from '@google-cloud/firestore';
import {
  createFirestoreInbox,
  type Inbox,
} from '@my-f-startup/google-firestore-inbox';
import type { Logger, ResolvedInboxConfig } from '../types/config';

export type ServiceInboxOptions = {
  firestore: Firestore;
  config: ResolvedInboxConfig;
  logger?: Logger;
};

/**
 * Inbox of the service: one collection for all its subscribers, each record keyed by
 * `<handler>:<messageId>`.
 */
export const createServiceInbox = (options: ServiceInboxOptions): Inbox => {
  const { firestore, config, logger } = options;

  return createFirestoreInbox({ ...config, firestore, logger });
};
