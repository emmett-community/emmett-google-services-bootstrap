import type {
  SubscriptionOptions,
  PubSubMessageBusLifecycle,
} from '@emmett-community/emmett-google-pubsub';
import type { RealtimeDBInlineProjectionDefinition } from '@emmett-community/emmett-google-realtime-db';
import type { FirestoreEventStoreOptions } from '@emmett-community/emmett-google-firestore';
import type { InboxOptions } from '@my-f-startup/google-firestore-inbox';
import type { OutboxOptions } from '@my-f-startup/google-firestore-outbox';
import type {
  CommandProcessor,
  EventSubscription,
  MessageBus,
  ScheduledMessageProcessor,
  EventStore,
} from '@event-driven-io/emmett';
import type { Firestore } from '@google-cloud/firestore';
import type { PubSub } from '@google-cloud/pubsub';
import type { Auth } from 'firebase-admin/auth';
import type { app as FirebaseAppNamespace } from 'firebase-admin';
import type { Database } from 'firebase-admin/database';

export type LogLevel =
  'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

/**
 * Canonical logger contract used across Emmett packages.
 * Matches Pino style (context, message).
 */
export interface Logger {
  debug(context: Record<string, unknown>, message?: string): void;
  info(context: Record<string, unknown>, message?: string): void;
  warn(context: Record<string, unknown>, message?: string): void;
  error(context: Record<string, unknown>, message?: string): void;
}

export type ObservabilityConfig = {
  logger?: Logger;
  logLevel?: LogLevel;
  environment?: string;
  createLogger?: boolean;
};

export type FirebaseConfig = {
  projectId?: string;
  databaseURL?: string;
  firestoreEmulatorHost?: string;
  databaseEmulatorHost?: string;
};

export type PubSubConfig = {
  projectId?: string;
  emulatorHost?: string;
  /** Prefix of topics and subscriptions. Defaults to `PUBSUB_TOPIC_PREFIX`, then the service name. */
  topicPrefix?: string;
  /**
   * Stable id of this service's subscriptions, shared by its replicas and kept across restarts.
   * Defaults to the service name.
   */
  subscriptionId?: string;
  subscriptionOptions?: SubscriptionOptions;
  autoCreateResources?: boolean;
  cleanupOnClose?: boolean;
  closePubSubClient?: boolean;
  /**
   * Time limit, in milliseconds, of each Pub/Sub client call of a publication, retries included.
   * Defaults to 10000: the publication after the commit of an append runs inside the request, and
   * what is not published in time stays in the outbox.
   */
  publishTimeoutMs?: number;
};

/**
 * Transactional outbox of the events the service publishes. The appended events whose type is in
 * `types` are stored in `collection` in the transaction of the append, published on the message
 * bus once the append committed, and published later by `ctx.outbox.publishPending()` when that
 * publication failed.
 */
export type OutboxConfig = {
  /** Types of the events published on the message bus. The other events stay in the service. */
  types: OutboxOptions['types'];
  /** Defaults to `<serviceName>-outbox`. */
  collection?: string;
} & Partial<
  Pick<OutboxOptions, 'minAgeMs' | 'publishTimeoutMs' | 'batchSize' | 'now'>
>;

/**
 * Inbox shared by the subscribers of the service, so each delivered message is handled once.
 */
export type InboxConfig = {
  /** Defaults to `<serviceName>-inbox`. */
  collection?: string;
} & Partial<
  Pick<InboxOptions, 'leaseMs' | 'renewEveryMs' | 'expiryMs' | 'now'>
>;

export type ResolvedOutboxConfig = OutboxConfig & { collection: string };

export type ResolvedInboxConfig = InboxConfig & { collection: string };

export type DependencyCheck = {
  name: string;
  check: () => Promise<void>;
  successMessage?: string;
  timeoutMs?: number;
  required?: boolean;
};

export type GracefulShutdownConfig = {
  timeoutMs?: number;
  exitOnComplete?: boolean;
  exitFn?: (code: number) => void;
};

export type MessageBusWithLifecycle = MessageBus &
  EventSubscription &
  CommandProcessor &
  ScheduledMessageProcessor &
  PubSubMessageBusLifecycle;

export interface FirebaseAdminLike {
  initializeApp(
    options: { projectId: string; databaseURL?: string },
    name?: string,
  ): FirebaseAppNamespace.App;
  app?: () => FirebaseAppNamespace.App;
  apps?: Array<FirebaseAppNamespace.App | null>;
}

export type ServiceBootstrapOverrides = {
  firebaseAdmin?: FirebaseAdminLike;
  firestore?: Firestore;
  database?: Database;
  auth?: Auth;
  pubsub?: PubSub;
  eventStore?: EventStore;
  messageBus?: MessageBusWithLifecycle;
};

/**
 * Main configuration for ServiceBootstrap.
 * Values can be provided explicitly or via environment variables.
 */
export type ServiceBootstrapConfig = {
  serviceName: string;
  firebase?: FirebaseConfig;
  pubsub?: PubSubConfig;
  eventStore?: {
    collections?: FirestoreEventStoreOptions['collections'];
    hooks?: FirestoreEventStoreOptions['hooks'];
  };
  /** Without it the service publishes nothing through an outbox and `ctx.outbox` is undefined. */
  outbox?: OutboxConfig;
  inbox?: InboxConfig;
  observability?: ObservabilityConfig;
  projections?: RealtimeDBInlineProjectionDefinition[];
  getCurrentTime?: () => Date;
  dependencies?: DependencyCheck[];
  includeDefaultDependencyChecks?: boolean;
  /** Check the Realtime Database with the default checks. Set to `false` for services that do not use it. */
  includeRealtimeDatabaseCheck?: boolean;
  autoStartMessageBus?: boolean;
  shutdownOnDependencyFailure?: boolean;
  shutdown?: GracefulShutdownConfig;
  _testOverrides?: ServiceBootstrapOverrides;
};

export type ResolvedFirebaseConfig = {
  projectId: string;
  databaseURL: string;
  firestoreEmulatorHost?: string;
  databaseEmulatorHost?: string;
};

export type ResolvedPubSubConfig = {
  projectId: string;
  emulatorHost?: string;
  topicPrefix: string;
  subscriptionId: string;
  subscriptionOptions?: SubscriptionOptions;
  autoCreateResources: boolean;
  cleanupOnClose: boolean;
  closePubSubClient: boolean;
  publishTimeoutMs: number;
};

export type ResolvedServiceBootstrapConfig = {
  serviceName: string;
  firebase: ResolvedFirebaseConfig;
  pubsub: ResolvedPubSubConfig;
  eventStore: {
    collections?: FirestoreEventStoreOptions['collections'];
    hooks?: FirestoreEventStoreOptions['hooks'];
  };
  outbox?: ResolvedOutboxConfig;
  inbox: ResolvedInboxConfig;
  observability: ObservabilityConfig;
  projections: RealtimeDBInlineProjectionDefinition[];
  getCurrentTime: () => Date;
  dependencies: DependencyCheck[];
  includeDefaultDependencyChecks: boolean;
  includeRealtimeDatabaseCheck: boolean;
  autoStartMessageBus: boolean;
  shutdownOnDependencyFailure: boolean;
  shutdown: GracefulShutdownConfig;
  _testOverrides?: ServiceBootstrapOverrides;
};
