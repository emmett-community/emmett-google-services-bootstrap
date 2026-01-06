import type { SubscriptionOptions, PubSubMessageBusLifecycle } from '@emmett-community/emmett-google-pubsub';
import type { RealtimeDBInlineProjectionDefinition } from '@emmett-community/emmett-google-realtime-db';
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

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';

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
  topicPrefix?: string;
  subscriptionOptions?: SubscriptionOptions;
  autoCreateResources?: boolean;
  cleanupOnClose?: boolean;
  closePubSubClient?: boolean;
};

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
  observability?: ObservabilityConfig;
  projections?: RealtimeDBInlineProjectionDefinition[];
  getCurrentTime?: () => Date;
  dependencies?: DependencyCheck[];
  includeDefaultDependencyChecks?: boolean;
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
  subscriptionOptions?: SubscriptionOptions;
  autoCreateResources: boolean;
  cleanupOnClose: boolean;
  closePubSubClient: boolean;
};

export type ResolvedServiceBootstrapConfig = {
  serviceName: string;
  firebase: ResolvedFirebaseConfig;
  pubsub: ResolvedPubSubConfig;
  observability: ObservabilityConfig;
  projections: RealtimeDBInlineProjectionDefinition[];
  getCurrentTime: () => Date;
  dependencies: DependencyCheck[];
  includeDefaultDependencyChecks: boolean;
  autoStartMessageBus: boolean;
  shutdownOnDependencyFailure: boolean;
  shutdown: GracefulShutdownConfig;
  _testOverrides?: ServiceBootstrapOverrides;
};
