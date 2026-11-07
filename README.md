# @emmett-community/emmett-google-services-bootstrap

Service bootstrap for event-driven apps using Google Cloud. This package wires Firebase Admin, Firestore event store, Realtime DB projections, PubSub message bus, and lifecycle utilities so services can start with minimal boilerplate.

[![npm version](https://img.shields.io/npm/v/@emmett-community/emmett-google-services-bootstrap.svg)](https://www.npmjs.com/package/@emmett-community/emmett-google-services-bootstrap) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Build and test](https://github.com/emmett-community/emmett-google-services-bootstrap/actions/workflows/build_and_test.yml/badge.svg)](https://github.com/emmett-community/emmett-google-services-bootstrap/actions/workflows/build_and_test.yml)

## Features

- ✅ One orchestrator to initialize Firebase, PubSub, and event store wiring
- ✅ Realtime DB projections hooked automatically
- ✅ Built-in dependency checks and graceful shutdown
- ✅ OpenAPI-ready app creation with sensible defaults
- ✅ Auth security handlers available without extra service deps
- ✅ No side effects on import

## Why this package exists

Most Emmett services repeat the same bootstrap work: Firebase Admin init, Firestore event store setup, PubSub wiring, and shutdown logic. This package centralizes that boilerplate into a single, explicit orchestrator.

## How it relates to other emmett-community packages

- It is **for application entrypoints** (service `index.ts`).
- It composes existing packages (firestore, pubsub, realtime-db, observability, expressjs-with-openapi).
- It keeps domain code untouched and wiring centralized.

## Installation

```bash
npm install @emmett-community/emmett-google-services-bootstrap
```

Minimal service dependencies:

```json
{
  "dependencies": {
    "@emmett-community/emmett-google-services-bootstrap": "^0.1.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}
```

## Quick start

```typescript
import { ServiceBootstrap } from '@emmett-community/emmett-google-services-bootstrap';
import { userDetailsProjection } from './projections/userDetailsProjection';
import { setupUserDataRemovalSubscriber } from './subscriptions/userDataRemovalSubscriber';

const bootstrap = new ServiceBootstrap({
  serviceName: 'user-service',
  projections: [userDetailsProjection],
});

await bootstrap.startApi({
  port: Number(process.env.PORT ?? 3000),
  openApiPath: './openapi.yml',
  handlersPath: './handlers',
  initializeHandlers: (handlers, ctx) => {
    handlers.users.initializeHandlers(
      ctx.eventStore,
      ctx.database,
      ctx.messageBus,
      ctx.getCurrentTime,
    );
  },
  beforeStart: (ctx) => {
    setupUserDataRemovalSubscriber({
      eventStore: ctx.eventStore,
      messageBus: ctx.messageBus,
      auth: ctx.auth,
      getCurrentTime: ctx.getCurrentTime,
    });
  },
});
```

## Configuration

### Environment variables

- `FIRESTORE_PROJECT_ID`: Firebase project id (fallback to `GCLOUD_PROJECT` / `GOOGLE_CLOUD_PROJECT`)
- `demo-project` fallback: if project id is missing and any emulator host is configured, defaults to `demo-project` (also used for PubSub)
- `FIRESTORE_EMULATOR_HOST`: Firestore emulator host
- `FIREBASE_DATABASE_EMULATOR_HOST`: Realtime DB emulator host
- `PUBSUB_PROJECT_ID`: PubSub project id
- `PUBSUB_EMULATOR_HOST`: PubSub emulator host
- `PUBSUB_TOPIC_PREFIX`: prefix of topics and subscriptions (used when `pubsub.topicPrefix` is not set; defaults to the service name)
- `LOG_LEVEL`: default log level for built-in logger
- `NODE_ENV`: forwarded to logging helpers

### Options

```typescript
import type { ServiceBootstrapConfig } from '@emmett-community/emmett-google-services-bootstrap';

const config: ServiceBootstrapConfig = {
  serviceName: 'user-service',
  firebase: {
    projectId: 'demo-project',
    databaseURL: 'https://demo-project-default-rtdb.firebaseio.com',
  },
  pubsub: {
    projectId: 'demo-project',
    topicPrefix: 'user-service',
    subscriptionId: 'user-service',
    autoCreateResources: true,
  },
  eventStore: {
    collections: {
      streams: 'user-service-streams',
      counters: '_user-service-counters',
    },
  },
  projections: [],
  observability: {
    createLogger: true,
    logLevel: 'info',
  },
  includeDefaultDependencyChecks: true,
  includeRealtimeDatabaseCheck: true,
  autoStartMessageBus: true,
  shutdownOnDependencyFailure: true,
};
```

### Subscriptions

Event and command subscriptions are named after the service, so they survive restarts and the replicas of a service share them:

- Events: `<topicPrefix>-evt-<EventType>-<subscriptionId>`. An event normally reaches one replica, but it can be delivered again, so handlers must be idempotent.
- Commands: `<topicPrefix>-cmd-<CommandType>-<subscriptionId>`, so a command has one handler.

`pubsub.subscriptionId` defaults to the service name. `includeRealtimeDatabaseCheck: false` leaves the Realtime Database out of the default dependency checks, for services that do not use it.

### Event store collection names

- `eventStore.collections.streams`: Firestore collection that stores stream metadata (defaults to `"streams"`).
- `eventStore.collections.counters`: Firestore collection for shared counters (defaults to `"_counters"`).

### Event store hooks

`eventStore.hooks` is passed as is to the Firestore event store. `hooks.beforeCommit(transaction, events)` runs inside the transaction of every append, so what it writes on the transaction commits atomically with the events. See the readme of `@emmett-community/emmett-google-firestore` for the rules of the hook. `ctx.eventStore.appendToStream` returns `messageIds`, the `messageId` stored on each event.

## API

### ServiceBootstrap

- `initialize()` initializes Firebase, PubSub, and the event store.
- `start()` runs dependency checks and returns the same context as `initialize()`.
- `createApp()` returns an Express app wired with OpenAPI validation.
- `shutdown(reason, exitCode?)` runs graceful shutdown tasks.
- `registerSignalHandlers()` installs SIGINT/SIGTERM handlers.
- `startApi()` initializes, runs checks, creates the app, and starts the HTTP server.
- `checkReadiness()` runs the readiness checks (also available as `ctx.checkReadiness`).

`ctx.eventStore` follows Emmett's `EventStore` contract: `readStream` returns `{ events, currentStreamVersion, streamExists }`.

### Health and readiness

The probes are routes of the service contract. Declare `GET /health` and `GET /ready` in the OpenAPI document and wire them to the handlers of the package:

```typescript
// handlers/health.ts: the module of x-eov-operation-handler: health
import type { NextFunction, Request, Response } from 'express';
import {
  getHealth as health,
  getReady as ready,
  type ServiceBootstrapContext,
} from '@emmett-community/emmett-google-services-bootstrap';

let readyHandler: ReturnType<typeof ready>;

// Called from the initializeHandlers option of startApi()/createApp()
export const initializeHandlers = (ctx: ServiceBootstrapContext) => {
  readyHandler = ready(ctx);
};

export const getHealth = health;
export const getReady = (req: Request, res: Response, next: NextFunction) =>
  readyHandler(req, res, next);
```

`/health` answers `200 { "status": "ok" }`. `/ready` answers `200 { "status": "ready", "checks": [...] }` when Firestore, the Realtime Database (unless `includeRealtimeDatabaseCheck` is `false`), the message bus and the configured `dependencies` answer, and `503 { "status": "unavailable", "checks": [...] }` otherwise. Each check has a 3 s timeout.

### Lifecycle utilities

- `DependencyChecker` and `startDependency()` for health checks.
- `GracefulShutdown` for ordered shutdown tasks (`registerFirst()` adds a task that runs before the others).
- `registerSignalHandlers()` to attach process signals.

`startApi()` closes the HTTP server first, then the message bus, Firestore and the Firebase app.

## What this package intentionally does NOT do

- Hide application infrastructure choices behind magic defaults
- Create domain handlers or business rules
- Start HTTP servers automatically (use `startApi()` if you want the helper)
- Require any specific deployment model

## Testing

`@emmett-community/emmett-google-services-bootstrap/testing` builds a service bootstrap on the in-memory Firestore, Realtime Database and Pub/Sub of the `/testing` entries of the platform libraries, with no emulator and no network. The event store, the projections and the message bus are the real ones:

```typescript
import { createTestServiceBootstrap } from '@emmett-community/emmett-google-services-bootstrap/testing';

const { bootstrap, firestore, database, messageBus } = createTestServiceBootstrap({
  serviceName: 'user-service',
  projections: [userDetailsProjection],
});

const ctx = await bootstrap.start();
```

Use `overrides` to replace any piece, for example to share one `pubsub` between two services.

For API tests, use `ApiSpecification` and `ApiE2ESpecification` from `@event-driven-io/emmett-expressjs` (install it in `devDependencies`, with the same version as `@event-driven-io/emmett`). They take the application right away, so wrap the one built by `createApp()` with `lazyApplication`, which this package re-exports:

```typescript
import { ApiSpecification, expectResponse } from '@event-driven-io/emmett-expressjs';
import { lazyApplication } from '@emmett-community/emmett-google-services-bootstrap';

const given = ApiSpecification.for(
  () => getInMemoryEventStore(),
  (eventStore) => lazyApplication(createTestApp(eventStore)),
);
```

To test this package:

```bash
npm run test:unit
npm run test:int
npm run test:e2e
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

---

Made with ❤️ by the Emmett Community
