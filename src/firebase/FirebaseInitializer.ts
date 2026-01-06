import admin from 'firebase-admin';
import type { Firestore } from '@google-cloud/firestore';
import type { Auth } from 'firebase-admin/auth';
import type { app as FirebaseAppNamespace } from 'firebase-admin';
import type { Database } from 'firebase-admin/database';
import type { FirebaseAdminLike, Logger } from '../types/config';

export type FirebaseInitializationOptions = {
  projectId: string;
  databaseURL?: string;
  firestoreEmulatorHost?: string;
  databaseEmulatorHost?: string;
  logger?: Logger;
  _firebaseAdmin?: FirebaseAdminLike;
};

export type FirebaseInitResult = {
  app: FirebaseAppNamespace.App;
  firestore: Firestore;
  database: Database;
  auth: Auth;
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

const safeLog = {
  debug: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.debug(normalizeContext(data), msg);
  },
  info: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.info(normalizeContext(data), msg);
  },
  warn: (logger: Logger | undefined, msg: string, data?: unknown): void => {
    if (!logger) return;
    logger.warn(normalizeContext(data), msg);
  },
  error: (logger: Logger | undefined, msg: string, error?: unknown): void => {
    if (!logger) return;
    logger.error(normalizeErrorContext(error), msg);
  },
};

/**
 * Initializes Firebase Admin SDK with emulator support.
 */
export class FirebaseInitializer {
  private readonly options: FirebaseInitializationOptions;

  constructor(options: FirebaseInitializationOptions) {
    this.options = options;
  }

  /**
   * Returns true if emulator hosts are configured.
   */
  isEmulatorMode(): boolean {
    return Boolean(
      this.options.firestoreEmulatorHost ||
        this.options.databaseEmulatorHost ||
        process.env.FIRESTORE_EMULATOR_HOST ||
        process.env.FIREBASE_DATABASE_EMULATOR_HOST,
    );
  }

  /**
   * Initialize Firebase Admin and return service handles.
   */
  async initialize(): Promise<FirebaseInitResult> {
    const {
      projectId,
      databaseURL,
      firestoreEmulatorHost,
      databaseEmulatorHost,
      logger,
    } = this.options;

    if (firestoreEmulatorHost && !process.env.FIRESTORE_EMULATOR_HOST) {
      process.env.FIRESTORE_EMULATOR_HOST = firestoreEmulatorHost;
    }

    if (databaseEmulatorHost && !process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = databaseEmulatorHost;
    }

    const resolvedDatabaseURL =
      databaseURL ?? this.getDatabaseURL(projectId, databaseEmulatorHost);

    const firebaseAdmin = this.options._firebaseAdmin ?? admin;
    const app = this.getOrCreateApp(firebaseAdmin, projectId, resolvedDatabaseURL);

    safeLog.info(logger, 'Firebase initialized', {
      projectId,
      databaseURL: resolvedDatabaseURL,
      emulatorMode: this.isEmulatorMode(),
    });

    const firestore = app.firestore();
    const database = app.database();
    const auth = app.auth();

    if (firestoreEmulatorHost) {
      firestore.settings({
        host: firestoreEmulatorHost,
        ssl: false,
      });
      safeLog.info(logger, 'Firestore emulator configured', {
        host: firestoreEmulatorHost,
      });
    }

    return { app, firestore, database, auth };
  }

  private getOrCreateApp(
    firebaseAdmin: FirebaseAdminLike,
    projectId: string,
    databaseURL: string,
  ): FirebaseAppNamespace.App {
    const apps = (firebaseAdmin.apps ?? []).filter(
      (app): app is FirebaseAppNamespace.App => app !== null,
    );

    if (apps.length > 0 && firebaseAdmin.app) {
      safeLog.debug(this.options.logger, 'Reusing existing Firebase app');
      return firebaseAdmin.app();
    }

    safeLog.debug(this.options.logger, 'Creating Firebase app');
    return firebaseAdmin.initializeApp(
      {
        projectId,
        databaseURL,
      },
    );
  }

  private getDatabaseURL(projectId: string, emulatorHost?: string): string {
    if (emulatorHost) {
      return `http://${emulatorHost}?ns=${projectId}`;
    }
    return `https://${projectId}-default-rtdb.firebaseio.com`;
  }
}
