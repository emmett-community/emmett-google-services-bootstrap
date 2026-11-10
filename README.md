# @emmett-community/emmett-google-services-bootstrap

Service bootstrap for event-driven apps using Google Cloud. This package wires Firebase Admin, Firestore event store, Realtime DB projections, PubSub message bus, and lifecycle utilities so services can start with minimal boilerplate.

[![npm version](https://img.shields.io/npm/v/@emmett-community/emmett-google-services-bootstrap.svg)](https://www.npmjs.com/package/@emmett-community/emmett-google-services-bootstrap) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT) [![Build and test](https://github.com/emmett-community/emmett-google-services-bootstrap/actions/workflows/build_and_test.yml/badge.svg)](https://github.com/emmett-community/emmett-google-services-bootstrap/actions/workflows/build_and_test.yml)

## Features

- ✅ One orchestrator to initialize Firebase, PubSub, and event store wiring
- ✅ Realtime DB projections hooked automatically
- ✅ Transactional outbox for the published events and an inbox for the subscribers, wired to the event store and the message bus
- ✅ Built-in dependency checks and graceful shutdown
- ✅ OpenAPI-ready app creation with sensible defaults
- ✅ Auth security handlers available without extra service deps, for users and for internal routes called by Google services
- ✅ No side effects on import

## Why this package exists

Most Emmett services repeat the same bootstrap work: Firebase Admin init, Firestore event store setup, PubSub wiring, and shutdown logic. This package centralizes that boilerplate into a single, explicit orchestrator.

## How it relates to other emmett-community packages

- It is **for application entrypoints** (service `index.ts`).
- It composes existing packages (firestore, pubsub, realtime-db, observability, expressjs-with-openapi), plus `@my-f-startup/google-firestore-outbox` and `@my-f-startup/google-firestore-inbox` for reliable messaging and `@my-f-startup/google-internal-auth` for internal routes.
- It keeps domain code untouched and wiring centralized.

## Installation

```bash
npm install @emmett-community/emmett-google-services-bootstrap
```

Minimal service dependencies:

```json
{
  "dependencies": {
    "@emmett-community/emmett-google-services-bootstrap": "^0.7.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21"
  }
}
```

## Quick start

```typescript
import { ServiceBootstrap } from '@emmett-community/emmett-google-services-bootstrap';
import { orderDetailsProjection } from './projections/orderDetailsProjection';
import { setupPaymentConfirmedSubscriber } from './subscriptions/paymentConfirmedSubscriber';

const bootstrap = new ServiceBootstrap({
  serviceName: 'orders-service',
  projections: [orderDetailsProjection],
  // Events published to other services, through the transactional outbox
  outbox: { types: ['OrderPlaced', 'OrderCancelled'] },
});

await bootstrap.startApi({
  port: Number(process.env.PORT ?? 3000),
  openApiPath: './openapi.yml',
  handlersPath: './handlers',
  initializeHandlers: (handlers, ctx) => {
    handlers.orders.initializeHandlers(
      ctx.eventStore,
      ctx.database,
      ctx.getCurrentTime,
    );
    handlers.jobs.initializeHandlers(ctx.outbox);
  },
  beforeStart: (ctx) => {
    // Each delivered message is handled once through ctx.inbox
    setupPaymentConfirmedSubscriber({
      eventStore: ctx.eventStore,
      inbox: ctx.inbox,
      messageBus: ctx.messageBus,
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
- `INTERNAL_ALLOWED_CALLERS` and `INTERNAL_AUDIENCE`: read by `internalAuthOptionsFromEnvironment` (see Internal routes)
- `LOG_LEVEL`: default log level for built-in logger
- `NODE_ENV`: forwarded to logging helpers

### Options

```typescript
import type { ServiceBootstrapConfig } from '@emmett-community/emmett-google-services-bootstrap';

const config: ServiceBootstrapConfig = {
  serviceName: 'orders-service',
  firebase: {
    projectId: 'demo-project',
    databaseURL: 'https://demo-project-default-rtdb.firebaseio.com',
  },
  pubsub: {
    projectId: 'demo-project',
    topicPrefix: 'orders-service',
    subscriptionId: 'orders-service',
    autoCreateResources: true,
  },
  eventStore: {
    collections: {
      streams: 'orders-service-streams',
      counters: '_orders-service-counters',
    },
  },
  outbox: {
    types: ['OrderPlaced', 'OrderCancelled'],
    collection: 'orders-service-outbox',
  },
  inbox: {
    collection: 'orders-service-inbox',
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

### Outbox

Publishing an event after appending it is two separate writes: if the process stops between them, or the broker is unavailable, the event is stored and never published. With `outbox` configured, the bootstrap closes that gap with `@my-f-startup/google-firestore-outbox`:

- In the transaction of every append, the events whose type is in `outbox.types` are stored in `outbox.collection` (default `<serviceName>-outbox`), together with the events. The other events stay in the service.
- After the commit, `ctx.eventStore.appendToStream` publishes them on the message bus, with the `messageId` stored on the event, and deletes their documents. A failed publication never fails the append: the event stays in the outbox.
- `ctx.outbox.publishPending()` publishes what was left, oldest first. Call it from a scheduled job; it returns `oldestAgeMs`, the age of the oldest event still waiting, which is the number to alert on.

`eventStore.hooks.beforeCommit` still runs, after the outbox record. `minAgeMs`, `publishTimeoutMs`, `batchSize` and `now` are passed to the outbox. Delivery is at least once, so subscribers must discard duplicates by `messageId`: that is what the inbox is for.

Two limits keep a request from waiting on Pub/Sub. `outbox.publishTimeoutMs` (default 10 s) is how long the append waits for its publication before it returns. `pubsub.publishTimeoutMs` (default 10 s) bounds each call of the Pub/Sub client, retries included, so a publication the append stopped waiting for does not keep retrying in the background: without it the client retries a failing publish for about 80 seconds. When Pub/Sub does not answer, the append commits, returns within the limit and leaves the event in the outbox (end to end test on the emulator with Pub/Sub unreachable). Keep `outbox.minAgeMs` (default 60 s) above the time a publication can take, so the job does not publish an event the request is still publishing.

Without `outbox`, nothing changes: `ctx.outbox` is `undefined` and handlers that call `ctx.messageBus.publish` publish directly.

### Inbox

`ctx.inbox` is an inbox of `@my-f-startup/google-firestore-inbox` for the subscribers of the service, in `inbox.collection` (default `<serviceName>-inbox`), so a message delivered again, to the same replica or to another one, is handled once. Each record is keyed by `<handler>:<messageId>`, so all subscribers share the collection. Pass the `record` function to the `beforeCommit` option of the append, so the record commits with the events:

```typescript
messageBus.subscribe(async (event) => {
  await ctx.inbox.handle({
    handler: 'confirmOrder',
    messageId: event.metadata.messageId,
    firestore: (record) =>
      ctx.eventStore.appendToStream(orderId, [orderConfirmed], {
        beforeCommit: record,
      }),
    external: [
      { name: 'sendEmail', class: 'keyed', run: ({ key }) => email.send(key) },
    ],
  });
}, 'OrderPlaced');
```

The side effects outside Firestore declare a class (`repeatable`, `keyed`, `checkable` or `unverifiable`) that says what happens when a delivery finds them interrupted. `leaseMs`, `renewEveryMs`, `expiryMs` and `now` are passed to the inbox. Records marked `done` carry `expiresAt`, for a Firestore TTL policy on the collection. The inbox errors (`InboxBusyError`, `LeaseLostError`, `UnverifiableEffectError`) and types are re-exported by this package.

## API

### ServiceBootstrap

- `initialize()` initializes Firebase, PubSub, and the event store.
- `start()` runs dependency checks and returns the same context as `initialize()`.
- `createApp()` returns an Express app wired with OpenAPI validation.
- `shutdown(reason, exitCode?)` runs graceful shutdown tasks.
- `registerSignalHandlers()` installs SIGINT/SIGTERM handlers.
- `startApi()` initializes, runs checks, creates the app, and starts the HTTP server.
- `checkReadiness()` runs the readiness checks (also available as `ctx.checkReadiness`).

`ctx.eventStore` follows Emmett's `EventStore` contract: `readStream` returns `{ events, currentStreamVersion, streamExists }`. `ctx.outbox` (when `outbox` is configured) and `ctx.inbox` are described above.

The inline projections are written right after the append commits, in a separate store, so a process that stops in between leaves the read models of that stream behind. `ctx.projectStream(streamName)` brings them up to date by applying the stored events of the stream to the configured projections: it is the `projectStream` of `@emmett-community/emmett-google-realtime-db`, wired to the event store and the projections of the service. Each projection skips the events it already applied, so calling it on a stream that is up to date changes nothing. A service typically calls it when a read model it expects is missing:

```typescript
const details = await getDetails(ctx.database, orderId);
if (!details) {
  await ctx.projectStream(orderId);
}
```

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

### Internal routes

A route called by a Google service, such as the outbox job called by Cloud Scheduler, is protected by an OpenAPI security scheme wired to `createInternalAuthHandler`, which this package re-exports from `@my-f-startup/google-internal-auth`. It accepts a bearer ID token issued by Google for `audience` (the URL of the service) whose verified email is one of `allowedCallers`, and rejects everything when either is missing:

```typescript
import {
  createFirebaseAuthSecurityHandlers,
  createInternalAuthHandler,
  internalAuthOptionsFromEnvironment,
} from '@emmett-community/emmett-google-services-bootstrap';

const openApiOptions = {
  validateSecurity: {
    handlers: {
      ...createFirebaseAuthSecurityHandlers({}),
      internalAuth: createInternalAuthHandler(
        internalAuthOptionsFromEnvironment(),
      ),
    },
  },
};
```

`internalAuthOptionsFromEnvironment` reads `INTERNAL_ALLOWED_CALLERS` (comma separated emails) and `INTERNAL_AUDIENCE`, and skips the check when an emulator host is configured, since there is no Google issued token against the emulators. The `Authorization` header is still required by the security scheme.

### Lifecycle utilities

- `DependencyChecker` and `startDependency()` for health checks.
- `GracefulShutdown` for ordered shutdown tasks (`registerFirst()` adds a task that runs before the others).
- `registerSignalHandlers()` to attach process signals.

`startApi()` closes the HTTP server first, then the message bus, Firestore and the Firebase app, and last flushes the pending spans when tracing was started.

### Tracing

`@emmett-community/emmett-google-services-bootstrap/tracing` starts OpenTelemetry tracing for the process: spans for incoming and outgoing HTTP requests and for the Express routes, next to the spans the Emmett libraries create. Instrumentation must be in place before the instrumented modules load, so this entry is loaded on its own with `node --import`, before the service:

```typescript
// src/tracing.ts
import { startTracing } from '@emmett-community/emmett-google-services-bootstrap/tracing';

await startTracing({ serviceName: 'orders-service' });
```

```bash
node --import ./dist/tracing.js dist/index.js
```

It does nothing unless an exporter is configured with the standard environment variables:

- `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`: export over OTLP/HTTP, for example to an OpenTelemetry Collector running next to the service.
- `OTEL_TRACES_EXPORTER=console`: write the spans to the console, to check them locally.

`OTEL_SERVICE_NAME` is used when `serviceName` is not given. The tracing entry registers the OpenTelemetry hook for ES modules (Node.js 20.6 or later), so an Express app imported with `import` is instrumented too. On shutdown, the bootstrap flushes the pending spans after its other tasks.

What one request produces is one trace, across the message bus:

- the HTTP request and its Express route;
- the event store append (`emmett.firestore.append_to_stream`), with the spans of the Firestore client (`Transaction.Run`, `Transaction.Commit`) and the outbox record under it;
- the publication of the event (`emmett.pubsub.publish_event`), with the spans of the Pub/Sub client under it: the bootstrap creates the client with `enableOpenTelemetryTracing`;
- in the service that receives the event, the handling (`emmett.pubsub.handle_event`), a child of the publication through the `traceparent` message attribute, with what the subscriber does under it (an append, an inbox record).

The Realtime Database client has no tracing of its own; the projections are traced by the spans of `@emmett-community/emmett-google-realtime-db`. An end to end test on the Firebase emulator suite runs a service in a process of its own, with the tracing loaded first, and checks this tree.

## What this package intentionally does NOT do

- Hide application infrastructure choices behind magic defaults
- Create domain handlers or business rules
- Start HTTP servers automatically (use `startApi()` if you want the helper)
- Require any specific deployment model

## Testing

`@emmett-community/emmett-google-services-bootstrap/testing` builds a service bootstrap on the in-memory Firestore, Realtime Database and Pub/Sub of the `/testing` entries of the platform libraries, with no emulator and no network. The event store, the projections, the message bus, the outbox and the inbox are the real ones:

```typescript
import { createTestServiceBootstrap } from '@emmett-community/emmett-google-services-bootstrap/testing';

const { bootstrap, firestore, database, messageBus } = createTestServiceBootstrap({
  serviceName: 'orders-service',
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
