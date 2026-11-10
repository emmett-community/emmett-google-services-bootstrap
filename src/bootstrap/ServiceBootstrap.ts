import path from 'node:path';
import type { Application } from 'express';
import { createLogger } from '@emmett-community/emmett-observability';
import {
  createOpenApiValidatorOptions,
  getApplication,
  startAPI,
  type ApplicationOptions,
  type ImportedHandlerModules,
  type OpenApiValidatorOptions,
} from '@emmett-community/emmett-expressjs-with-openapi';
import { getPubSubMessageBus } from '@emmett-community/emmett-google-pubsub';
import { projectStream } from '@emmett-community/emmett-google-realtime-db';
import type { EventStore } from '@event-driven-io/emmett';
import type { Firestore } from '@google-cloud/firestore';
import type { PubSub } from '@google-cloud/pubsub';
import type { Auth } from 'firebase-admin/auth';
import type { app as FirebaseAppNamespace } from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import { FirebaseInitializer } from '../firebase/FirebaseInitializer';
import { PubSubInitializer } from '../pubsub/PubSubInitializer';
import { createEventStore } from '../eventstore/EventStoreFactory';
import {
  DependencyChecker,
  type DependencyCheckSummary,
} from '../lifecycle/DependencyChecker';
import {
  GracefulShutdown,
  type GracefulShutdownResult,
} from '../lifecycle/GracefulShutdown';
import { registerSignalHandlers } from '../lifecycle/SignalHandlers';
import { getTracingShutdown } from '../tracing/shutdown';
import type { Inbox } from '@my-f-startup/google-firestore-inbox';
import type { Outbox } from '@my-f-startup/google-firestore-outbox';
import { createServiceInbox } from '../messaging/inbox';
import {
  createServiceOutbox,
  withOutboxRecord,
  withPublishAfterCommit,
} from '../messaging/outbox';
import type {
  DependencyCheck,
  Logger as BootstrapLogger,
  MessageBusWithLifecycle,
  ResolvedServiceBootstrapConfig,
  ServiceBootstrapConfig,
} from '../types/config';

/**
 * Runtime context produced by ServiceBootstrap.
 */
export type ServiceBootstrapContext = {
  serviceName: string;
  firebase: {
    app: FirebaseAppNamespace.App;
    firestore: Firestore;
    database: Database;
    auth: Auth;
  };
  firestore: Firestore;
  database: Database;
  auth: Auth;
  pubsub: PubSub;
  /** With an outbox configured, it records and publishes the events of the outbox types. */
  eventStore: EventStore;
  messageBus: MessageBusWithLifecycle;
  /** Defined when `outbox` is configured. `publishPending()` is the recovery job. */
  outbox?: Outbox;
  /** Inbox shared by the subscribers of the service. */
  inbox: Inbox;
  logger?: BootstrapLogger;
  getCurrentTime: () => Date;
  config: ResolvedServiceBootstrapConfig;
  /**
   * Runs the readiness checks (the same dependencies the startup checks, without starting the
   * message bus again). Used by the `/ready` handler.
   */
  checkReadiness: () => Promise<DependencyCheckSummary>;
  /**
   * Brings the read models of one stream up to date by applying its stored events to the
   * configured projections. The inline projections are written after the append commits, so a
   * process that stops in between leaves them behind; this catches them up. The projections skip
   * the events they already applied, so calling it on an up-to-date stream changes nothing.
   */
  projectStream: (streamName: string) => Promise<void>;
};

/**
 * Error thrown when required dependencies fail health checks.
 */
export class DependencyUnavailableError extends Error {
  readonly summary: DependencyCheckSummary;

  constructor(summary: DependencyCheckSummary) {
    const failed = summary.results
      .filter((result) => result.required && !result.ok)
      .map((result) => result.name)
      .join(', ');

    super(`Dependency check failed: ${failed}`);
    this.name = 'DependencyUnavailableError';
    this.summary = summary;
  }
}

export type CreateAppOptions = {
  openApiPath: string;
  handlersPath: string;
  initializeHandlers: (
    handlers?: ImportedHandlerModules,
  ) => void | Promise<void>;
  openApiOptions?: Partial<
    Omit<
      OpenApiValidatorOptions,
      'apiSpec' | 'operationHandlers' | 'initializeHandlers'
    >
  >;
  appOptions?: Omit<ApplicationOptions, 'openApiValidator' | 'observability'>;
};

export type StartApiOptions = Omit<CreateAppOptions, 'initializeHandlers'> & {
  initializeHandlers: (
    handlers: ImportedHandlerModules | undefined,
    ctx: ServiceBootstrapContext,
  ) => void | Promise<void>;
  port?: number;
  registerSignalHandlers?: boolean;
  beforeStart?: (ctx: ServiceBootstrapContext) => void | Promise<void>;
};

const READINESS_CHECK_TIMEOUT_MS = 3000;

const resolvePath = (inputPath: string): string => {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
};

// Well under the 60 s a gateway gives a request; a healthy publication takes milliseconds
const DEFAULT_PUBLISH_TIMEOUT_MS = 10000;

/**
 * Orchestrates Firebase, PubSub, event store, and lifecycle utilities.
 */
export class ServiceBootstrap {
  private readonly config: ServiceBootstrapConfig;
  private resolvedConfig?: ResolvedServiceBootstrapConfig;
  private logger?: BootstrapLogger;
  private context?: ServiceBootstrapContext;
  private dependencyChecker?: DependencyChecker;
  private shutdownManager?: GracefulShutdown;

  constructor(config: ServiceBootstrapConfig) {
    this.config = config;
  }

  /**
   * Resolve configuration with defaults and environment variables.
   */
  getConfig(): ResolvedServiceBootstrapConfig {
    return this.resolveConfig();
  }

  /**
   * Return the initialized context if available.
   */
  getContext(): ServiceBootstrapContext | undefined {
    return this.context;
  }

  /**
   * Register process signal handlers that trigger shutdown.
   */
  registerSignalHandlers(options?: {
    signals?: NodeJS.Signals[];
    exitCode?: number;
  }): () => void {
    return registerSignalHandlers({
      shutdown: async (reason, exitCode) => {
        await this.shutdown(reason, exitCode);
      },
      signals: options?.signals,
      logger: this.getLogger(),
      exitCode: options?.exitCode,
    });
  }

  /**
   * Create an Express app using emmett-expressjs-with-openapi defaults.
   */
  async createApp(options: CreateAppOptions) {
    const logger = this.getLogger();
    const openApiValidator = createOpenApiValidatorOptions(
      resolvePath(options.openApiPath),
      {
        ...options.openApiOptions,
        operationHandlers: resolvePath(options.handlersPath),
        initializeHandlers: options.initializeHandlers,
      },
    );

    return getApplication({
      ...(options.appOptions ?? {}),
      openApiValidator,
      observability: logger ? { logger } : undefined,
    });
  }

  /**
   * Initialize, run dependency checks, create the app, and start the HTTP server.
   */
  async startApi(options: StartApiOptions): Promise<{
    app: Application;
    server: ReturnType<typeof startAPI>;
    context: ServiceBootstrapContext;
  }> {
    const {
      port,
      registerSignalHandlers,
      beforeStart,
      initializeHandlers,
      ...createAppOptions
    } = options;

    const logger = this.getLogger();

    try {
      const ctx = await this.initialize();

      if (beforeStart) {
        await beforeStart(ctx);
      }

      if (registerSignalHandlers !== false) {
        this.registerSignalHandlers();
      }

      await this.start();

      const app = await this.createApp({
        ...createAppOptions,
        initializeHandlers: (handlers) => initializeHandlers(handlers, ctx),
      });

      const server = startAPI(app, { port, logger });

      // Closed before everything else, so no request reaches a store that is already closing
      this.getShutdownManager().registerFirst({
        name: 'httpServer',
        close: () =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      });

      logger?.info({ port: port ?? 3000 }, 'API server started');

      return { app, server, context: ctx };
    } catch (error) {
      logger?.error({ err: error }, 'Startup failed');
      await this.shutdown('Startup failed');
      throw error;
    }
  }

  /**
   * Initialize Firebase, PubSub, and event store wiring.
   * Does not execute dependency checks.
   */
  async initialize(): Promise<ServiceBootstrapContext> {
    if (this.context) {
      return this.context;
    }

    const resolvedConfig = this.resolveConfig();
    const logger = this.getLogger();

    const firebaseInitializer = new FirebaseInitializer({
      projectId: resolvedConfig.firebase.projectId,
      databaseURL: resolvedConfig.firebase.databaseURL,
      firestoreEmulatorHost: resolvedConfig.firebase.firestoreEmulatorHost,
      databaseEmulatorHost: resolvedConfig.firebase.databaseEmulatorHost,
      logger,
      _firebaseAdmin: resolvedConfig._testOverrides?.firebaseAdmin,
    });

    const firebase = await firebaseInitializer.initialize();

    const firestore =
      resolvedConfig._testOverrides?.firestore ?? firebase.firestore;
    const database =
      resolvedConfig._testOverrides?.database ?? firebase.database;
    const auth = resolvedConfig._testOverrides?.auth ?? firebase.auth;

    const pubsubInitializer = new PubSubInitializer({
      projectId: resolvedConfig.pubsub.projectId,
      emulatorHost: resolvedConfig.pubsub.emulatorHost,
      logger,
      _pubsub: resolvedConfig._testOverrides?.pubsub,
    });

    const pubsub = await pubsubInitializer.initialize();

    const messageBus =
      resolvedConfig._testOverrides?.messageBus ??
      getPubSubMessageBus({
        pubsub,
        useEmulator: pubsubInitializer.isEmulatorMode(),
        topicPrefix: resolvedConfig.pubsub.topicPrefix,
        // Event subscriptions are shared by the replicas of the service and survive restarts
        subscriptionId: resolvedConfig.pubsub.subscriptionId,
        // Command subscriptions are shared too, so a command has one handler
        instanceId: resolvedConfig.pubsub.subscriptionId,
        subscriptionOptions: resolvedConfig.pubsub.subscriptionOptions,
        autoCreateResources: resolvedConfig.pubsub.autoCreateResources,
        cleanupOnClose: resolvedConfig.pubsub.cleanupOnClose,
        closePubSubClient: resolvedConfig.pubsub.closePubSubClient,
        publishTimeoutMs: resolvedConfig.pubsub.publishTimeoutMs,
        observability: { logger },
      });

    const outbox = resolvedConfig.outbox
      ? createServiceOutbox({
          firestore,
          messageBus,
          config: resolvedConfig.outbox,
          logger,
        })
      : undefined;

    const eventStore = this.buildEventStore({
      firestore,
      database,
      outbox,
      logger,
    });

    const inbox = createServiceInbox({
      firestore,
      config: resolvedConfig.inbox,
      logger,
    });

    this.shutdownManager = new GracefulShutdown({
      ...resolvedConfig.shutdown,
      logger,
    });

    this.registerDefaultShutdownTasks({
      messageBus,
      firestore,
      firebaseApp: firebase.app,
    });

    this.dependencyChecker = new DependencyChecker({ logger });

    this.context = {
      serviceName: resolvedConfig.serviceName,
      firebase: {
        app: firebase.app,
        firestore,
        database,
        auth,
      },
      firestore,
      database,
      auth,
      pubsub,
      eventStore,
      messageBus,
      outbox,
      inbox,
      logger,
      getCurrentTime: resolvedConfig.getCurrentTime,
      config: resolvedConfig,
      checkReadiness: () => this.checkReadiness(),
      projectStream: (streamName: string) =>
        projectStream({
          eventStore,
          database,
          projections: resolvedConfig.projections,
          streamName,
          observability: logger ? { logger } : undefined,
        }),
    };

    return this.context;
  }

  /**
   * Initialize and run dependency checks before returning context.
   */
  async start(): Promise<ServiceBootstrapContext> {
    const ctx = await this.initialize();
    const resolvedConfig = this.resolveConfig();

    const checks: DependencyCheck[] = [];

    if (resolvedConfig.includeDefaultDependencyChecks) {
      checks.push(...this.buildDefaultDependencyChecks(ctx));
    }

    if (resolvedConfig.dependencies.length > 0) {
      checks.push(...resolvedConfig.dependencies);
    }

    if (checks.length > 0) {
      const summary = await this.getDependencyChecker().checkAll(checks);

      if (!summary.ok) {
        const error = new DependencyUnavailableError(summary);

        this.logger?.error(
          {
            err: error,
            results: summary.results,
          },
          'Dependency checks failed',
        );

        if (resolvedConfig.shutdownOnDependencyFailure) {
          await this.shutdown('Dependency check failed');
        }

        throw error;
      }
    }

    this.logger?.info(
      { serviceName: resolvedConfig.serviceName },
      'Service is running',
    );

    return ctx;
  }

  /**
   * Run the readiness checks: the stores and the message bus must answer, plus the configured
   * dependencies. A hung dependency fails the check instead of hanging the probe.
   */
  async checkReadiness(): Promise<DependencyCheckSummary> {
    const ctx = await this.initialize();
    const resolvedConfig = this.resolveConfig();

    const checks: DependencyCheck[] = [];

    if (resolvedConfig.includeDefaultDependencyChecks) {
      checks.push(...this.buildStoreDependencyChecks(ctx));

      if (resolvedConfig.autoStartMessageBus) {
        checks.push({
          name: 'PubSub',
          check: () =>
            ctx.messageBus.isStarted?.()
              ? Promise.resolve()
              : Promise.reject(new Error('Message bus is not started')),
        });
      }
    }

    checks.push(...resolvedConfig.dependencies);

    return this.getDependencyChecker().checkAll(
      checks.map((check) => ({
        ...check,
        timeoutMs: check.timeoutMs ?? READINESS_CHECK_TIMEOUT_MS,
      })),
    );
  }

  /**
   * Execute graceful shutdown tasks and return the shutdown result.
   */
  async shutdown(
    reason: string,
    exitCode = 1,
  ): Promise<GracefulShutdownResult> {
    return this.getShutdownManager().shutdown(reason, exitCode);
  }

  private buildEventStore(options: {
    firestore: Firestore;
    database: Database;
    outbox?: Outbox;
    logger?: BootstrapLogger;
  }): EventStore {
    const resolvedConfig = this.resolveConfig();
    const { firestore, database, outbox, logger } = options;

    const override = resolvedConfig._testOverrides?.eventStore;
    if (override) {
      return override;
    }

    const hooks = outbox
      ? withOutboxRecord(outbox, resolvedConfig.eventStore.hooks)
      : resolvedConfig.eventStore.hooks;

    const eventStore = createEventStore({
      firestore,
      database,
      projections: resolvedConfig.projections,
      collections: resolvedConfig.eventStore.collections,
      hooks,
      logger,
    });

    return outbox ? withPublishAfterCommit(eventStore, outbox) : eventStore;
  }

  private getLogger(): BootstrapLogger | undefined {
    if (this.logger !== undefined) {
      return this.logger;
    }

    const resolvedConfig = this.resolveConfig();
    const observability = resolvedConfig.observability;

    if (observability.logger) {
      this.logger = observability.logger;
      return this.logger;
    }

    if (observability.createLogger === false) {
      this.logger = undefined;
      return this.logger;
    }

    this.logger = createLogger({
      serviceName: resolvedConfig.serviceName,
      environment: observability.environment,
      logLevel: observability.logLevel,
    });

    return this.logger;
  }

  private resolveConfig(): ResolvedServiceBootstrapConfig {
    if (this.resolvedConfig) {
      return this.resolvedConfig;
    }

    const missing: string[] = [];

    const serviceName = this.config.serviceName?.trim();
    if (!serviceName) {
      missing.push('serviceName');
    }

    const firestoreEmulatorHost =
      this.config.firebase?.firestoreEmulatorHost ??
      process.env.FIRESTORE_EMULATOR_HOST;

    const databaseEmulatorHost =
      this.config.firebase?.databaseEmulatorHost ??
      process.env.FIREBASE_DATABASE_EMULATOR_HOST;

    const pubsubEmulatorHost =
      this.config.pubsub?.emulatorHost ?? process.env.PUBSUB_EMULATOR_HOST;

    const hasEmulator =
      Boolean(firestoreEmulatorHost) ||
      Boolean(databaseEmulatorHost) ||
      Boolean(pubsubEmulatorHost);

    const firebaseProjectId =
      this.config.firebase?.projectId ??
      process.env.FIRESTORE_PROJECT_ID ??
      process.env.GCLOUD_PROJECT ??
      process.env.GOOGLE_CLOUD_PROJECT ??
      (hasEmulator ? 'demo-project' : undefined);

    if (!firebaseProjectId) {
      missing.push('firebase.projectId (or FIRESTORE_PROJECT_ID)');
    }

    const pubsubProjectId =
      this.config.pubsub?.projectId ??
      process.env.PUBSUB_PROJECT_ID ??
      firebaseProjectId ??
      (hasEmulator ? 'demo-project' : undefined);

    if (!pubsubProjectId) {
      missing.push('pubsub.projectId (or PUBSUB_PROJECT_ID)');
    }

    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }

    const resolvedServiceName = serviceName;
    const resolvedFirebaseProjectId = firebaseProjectId as string;
    const resolvedPubsubProjectId = pubsubProjectId as string;

    const databaseURL =
      this.config.firebase?.databaseURL ??
      this.getDatabaseURL(resolvedFirebaseProjectId, databaseEmulatorHost);

    const observability = {
      ...this.config.observability,
      environment:
        this.config.observability?.environment ?? process.env.NODE_ENV,
      logLevel:
        this.config.observability?.logLevel ??
        (process.env.LOG_LEVEL as
          | 'fatal'
          | 'error'
          | 'warn'
          | 'info'
          | 'debug'
          | 'trace'
          | 'silent'
          | undefined),
      createLogger: this.config.observability?.createLogger ?? true,
    };

    const getCurrentTime = this.config.getCurrentTime ?? (() => new Date());

    this.resolvedConfig = {
      serviceName: resolvedServiceName,
      firebase: {
        projectId: resolvedFirebaseProjectId,
        databaseURL,
        firestoreEmulatorHost,
        databaseEmulatorHost,
      },
      pubsub: {
        projectId: resolvedPubsubProjectId,
        emulatorHost: pubsubEmulatorHost,
        topicPrefix:
          this.config.pubsub?.topicPrefix ??
          process.env.PUBSUB_TOPIC_PREFIX ??
          resolvedServiceName,
        subscriptionId:
          this.config.pubsub?.subscriptionId ?? resolvedServiceName,
        subscriptionOptions: this.config.pubsub?.subscriptionOptions,
        autoCreateResources: this.config.pubsub?.autoCreateResources ?? true,
        cleanupOnClose: this.config.pubsub?.cleanupOnClose ?? false,
        closePubSubClient: this.config.pubsub?.closePubSubClient ?? true,
        publishTimeoutMs:
          this.config.pubsub?.publishTimeoutMs ?? DEFAULT_PUBLISH_TIMEOUT_MS,
      },
      observability,
      projections: this.config.projections ?? [],
      getCurrentTime,
      dependencies: this.config.dependencies ?? [],
      includeDefaultDependencyChecks:
        this.config.includeDefaultDependencyChecks ?? true,
      includeRealtimeDatabaseCheck:
        this.config.includeRealtimeDatabaseCheck ?? true,
      autoStartMessageBus: this.config.autoStartMessageBus ?? true,
      shutdownOnDependencyFailure:
        this.config.shutdownOnDependencyFailure ?? true,
      shutdown: {
        timeoutMs: this.config.shutdown?.timeoutMs ?? 30000,
        exitOnComplete: this.config.shutdown?.exitOnComplete ?? false,
        exitFn: this.config.shutdown?.exitFn,
      },
      eventStore: {
        collections: this.config.eventStore?.collections,
        hooks: this.config.eventStore?.hooks,
      },
      outbox: this.config.outbox
        ? {
            ...this.config.outbox,
            collection:
              this.config.outbox.collection ?? `${resolvedServiceName}-outbox`,
          }
        : undefined,
      inbox: {
        ...this.config.inbox,
        collection:
          this.config.inbox?.collection ?? `${resolvedServiceName}-inbox`,
      },
      _testOverrides: this.config._testOverrides,
    };

    return this.resolvedConfig;
  }

  private getDatabaseURL(projectId: string, emulatorHost?: string): string {
    if (emulatorHost) {
      return `http://${emulatorHost}?ns=${projectId}`;
    }
    return `https://${projectId}-default-rtdb.firebaseio.com`;
  }

  private getDependencyChecker(): DependencyChecker {
    if (!this.dependencyChecker) {
      this.dependencyChecker = new DependencyChecker({
        logger: this.getLogger(),
      });
    }
    return this.dependencyChecker;
  }

  private getShutdownManager(): GracefulShutdown {
    if (!this.shutdownManager) {
      this.shutdownManager = new GracefulShutdown({
        ...this.resolveConfig().shutdown,
        logger: this.getLogger(),
      });
    }
    return this.shutdownManager;
  }

  private registerDefaultShutdownTasks(options: {
    messageBus: MessageBusWithLifecycle;
    firestore: Firestore;
    firebaseApp: FirebaseAppNamespace.App;
  }): void {
    const shutdownManager = this.getShutdownManager();

    if (options.messageBus?.close) {
      shutdownManager.register({
        name: 'messageBus',
        close: () => options.messageBus.close(),
      });
    }

    if (typeof options.firestore.terminate === 'function') {
      shutdownManager.register({
        name: 'firestore',
        close: () => options.firestore.terminate(),
      });
    }

    if (typeof options.firebaseApp.delete === 'function') {
      shutdownManager.register({
        name: 'firebaseApp',
        close: () => options.firebaseApp.delete(),
      });
    }

    // Last, so the spans of the other shutdown tasks are flushed too
    const stopTracing = getTracingShutdown();
    if (stopTracing) {
      shutdownManager.register({ name: 'tracing', close: stopTracing });
    }
  }

  private buildDefaultDependencyChecks(
    ctx: ServiceBootstrapContext,
  ): DependencyCheck[] {
    const checks: DependencyCheck[] = [];

    if (this.resolveConfig().autoStartMessageBus) {
      checks.push({
        name: 'PubSub',
        check: () => ctx.messageBus.start(),
        successMessage: 'Message bus started',
      });
    }

    checks.push(...this.buildStoreDependencyChecks(ctx));

    return checks;
  }

  private buildStoreDependencyChecks(
    ctx: ServiceBootstrapContext,
  ): DependencyCheck[] {
    const checks: DependencyCheck[] = [
      {
        name: 'Firestore',
        check: async () => {
          await ctx.firestore.collection('_healthcheck').limit(1).get();
        },
      },
    ];

    if (this.resolveConfig().includeRealtimeDatabaseCheck) {
      checks.push({
        name: 'Realtime Database',
        check: async () => {
          await ctx.database.ref('_healthcheck/connection').once('value');
        },
      });
    }

    return checks;
  }
}
