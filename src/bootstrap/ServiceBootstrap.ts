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
import {
  getPubSubMessageBus,
  type Logger as PubSubLogger,
} from '@emmett-community/emmett-google-pubsub';
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
  eventStore: EventStore;
  messageBus: MessageBusWithLifecycle;
  logger?: BootstrapLogger;
  getCurrentTime: () => Date;
  config: ResolvedServiceBootstrapConfig;
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
  initializeHandlers: (handlers?: ImportedHandlerModules) => void | Promise<void>;
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

const normalizeContext = (data: unknown): Record<string, unknown> => {
  if (data === undefined || data === null) return {};
  if (typeof data === 'object' && !Array.isArray(data)) {
    return { ...(data as Record<string, unknown>) };
  }
  return { data };
};

const normalizeErrorContext = (error: unknown): Record<string, unknown> => {
  if (error === undefined || error === null) return {};
  if (error instanceof Error) return { err: error };
  if (typeof error === 'object' && !Array.isArray(error)) {
    return { ...(error as Record<string, unknown>) };
  }
  return { err: error };
};

const createPubSubLogger = (
  logger?: BootstrapLogger,
): PubSubLogger | undefined => {
  if (!logger) return undefined;
  // Adapter: PubSub logger expects (msg, data), canonical logger uses (context, msg).
  const canonicalLogger = logger as any;
  return {
    debug: (msg, data) => canonicalLogger.debug(normalizeContext(data), msg),
    info: (msg, data) => canonicalLogger.info(normalizeContext(data), msg),
    warn: (msg, data) => canonicalLogger.warn(normalizeContext(data), msg),
    error: (msg, error) =>
      canonicalLogger.error(normalizeErrorContext(error), msg),
  };
};

const resolvePath = (inputPath: string): string => {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
};

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

      this.getShutdownManager().register({
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

    const firestore = resolvedConfig._testOverrides?.firestore ?? firebase.firestore;
    const database = resolvedConfig._testOverrides?.database ?? firebase.database;
    const auth = resolvedConfig._testOverrides?.auth ?? firebase.auth;

    const pubsubInitializer = new PubSubInitializer({
      projectId: resolvedConfig.pubsub.projectId,
      emulatorHost: resolvedConfig.pubsub.emulatorHost,
      logger,
      _pubsub: resolvedConfig._testOverrides?.pubsub,
    });

    const pubsub = await pubsubInitializer.initialize();

    const eventStore =
      resolvedConfig._testOverrides?.eventStore ??
      createEventStore({
        firestore,
        database,
        projections: resolvedConfig.projections,
        collections: resolvedConfig.eventStore.collections,
        logger,
      });

    const messageBus =
      resolvedConfig._testOverrides?.messageBus ??
      getPubSubMessageBus({
        pubsub,
        useEmulator: pubsubInitializer.isEmulatorMode(),
        topicPrefix: resolvedConfig.pubsub.topicPrefix,
        subscriptionOptions: resolvedConfig.pubsub.subscriptionOptions,
        autoCreateResources: resolvedConfig.pubsub.autoCreateResources,
        cleanupOnClose: resolvedConfig.pubsub.cleanupOnClose,
        closePubSubClient: resolvedConfig.pubsub.closePubSubClient,
        observability: { logger: createPubSubLogger(logger) },
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
      logger,
      getCurrentTime: resolvedConfig.getCurrentTime,
      config: resolvedConfig,
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
   * Execute graceful shutdown tasks and return the shutdown result.
   */
  async shutdown(reason: string, exitCode = 1): Promise<GracefulShutdownResult> {
    return this.getShutdownManager().shutdown(reason, exitCode);
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

    const resolvedServiceName = serviceName as string;
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
        topicPrefix: this.config.pubsub?.topicPrefix ?? resolvedServiceName,
        subscriptionOptions: this.config.pubsub?.subscriptionOptions,
        autoCreateResources: this.config.pubsub?.autoCreateResources ?? true,
        cleanupOnClose: this.config.pubsub?.cleanupOnClose ?? false,
        closePubSubClient: this.config.pubsub?.closePubSubClient ?? true,
      },
      observability,
      projections: this.config.projections ?? [],
      getCurrentTime,
      dependencies: this.config.dependencies ?? [],
      includeDefaultDependencyChecks:
        this.config.includeDefaultDependencyChecks ?? true,
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
      this.dependencyChecker = new DependencyChecker({ logger: this.getLogger() });
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

    checks.push({
      name: 'Firestore',
      check: async () => {
        await ctx.firestore.doc('_healthcheck/connection').get();
      },
    });

    checks.push({
      name: 'Realtime Database',
      check: async () => {
        await ctx.database.ref('_healthcheck/connection').once('value');
      },
    });

    return checks;
  }
}
