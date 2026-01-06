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
    autoCreateResources: true,
  },
  projections: [],
  observability: {
    createLogger: true,
    logLevel: 'info',
  },
  includeDefaultDependencyChecks: true,
  autoStartMessageBus: true,
  shutdownOnDependencyFailure: true,
};
```

## API

### ServiceBootstrap

- `initialize()` initializes Firebase, PubSub, and the event store.
- `start()` runs dependency checks and returns the same context as `initialize()`.
- `createApp()` returns an Express app wired with OpenAPI validation.
- `shutdown(reason, exitCode?)` runs graceful shutdown tasks.
- `registerSignalHandlers()` installs SIGINT/SIGTERM handlers.
- `startApi()` initializes, runs checks, creates the app, and starts the HTTP server.

### Lifecycle utilities

- `DependencyChecker` and `startDependency()` for health checks.
- `GracefulShutdown` for ordered shutdown tasks.
- `registerSignalHandlers()` to attach process signals.

## What this package intentionally does NOT do

- Hide application infrastructure choices behind magic defaults
- Create domain handlers or business rules
- Start HTTP servers automatically (use `startApi()` if you want the helper)
- Require any specific deployment model

## Testing

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
