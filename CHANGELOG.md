# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [0.6.0] - 2026-11-07

### Changed

- Depends on `@emmett-community/emmett-google-firestore` ^0.8.0. `ctx.eventStore.appendToStream` accepts the `beforeCommit` option of that version, a hook for one append run in its transaction after `eventStore.hooks.beforeCommit`, and the in-memory Firestore of `createTestServiceBootstrap` supports `create` and `delete` in transactions.
- Depends on `@emmett-community/emmett-google-realtime-db` ^0.9.0. The inline projections receive the `messageId` stored with each event and the metadata given on append.

- `FirebaseInitializer.initialize`, `PubSubInitializer.initialize`, the default message bus readiness check and `getHealth` return their promise without an `async` function that never awaits. A failure still rejects the promise, as before.

### Added

- Tests that the `beforeCommit` option of one append crosses the wrappers of the bootstrap, and that the projections receive the stored `messageId` and the metadata given on append.
- Linting and formatting: ESLint 9 in the flat format (`eslint.config.mjs`, with `tsconfig.eslint.json` so the tests are type checked) and Prettier, with `lint`, `lint:fix`, `format` and `format:check` scripts. The tests are typed: no `any`, and `messageBus.subscribe` receives the event type as a string, as its signature declares, instead of an array.

## [0.5.0] - 2026-11-07

### Added

- `eventStore.hooks` option, passed as is to the Firestore event store. `hooks.beforeCommit` runs inside the transaction of every append, so a service can add writes that commit atomically with its events.

### Changed

- Depends on `@emmett-community/emmett-google-firestore` ^0.7.0. `ctx.eventStore.appendToStream` now returns `messageIds`, the `messageId` stored on each event.

## [0.4.0] - 2026-11-04

### Added

- Stable subscriptions: event subscriptions are named `<topicPrefix>-evt-<EventType>-<subscriptionId>` and command subscriptions `<topicPrefix>-cmd-<CommandType>-<subscriptionId>`. `pubsub.subscriptionId` defaults to the service name, so subscriptions survive restarts and the replicas of a service share them: an event normally reaches one replica, and a command has one handler.
- `PUBSUB_TOPIC_PREFIX` environment variable for the topic prefix, used when `pubsub.topicPrefix` is not set. The default stays the service name.
- `getHealth` and `getReady(ctx)` handlers for the `/health` and `/ready` operations of a service contract, and `ctx.checkReadiness()` / `ServiceBootstrap.checkReadiness()`. `/ready` answers 503 with the failed checks when a dependency does not answer, with a 3 s timeout per check.
- `includeRealtimeDatabaseCheck` option (default `true`) to leave the Realtime Database out of the default dependency checks.
- `GracefulShutdown.registerFirst()`.
- `@emmett-community/emmett-google-services-bootstrap/testing` entry with `createTestServiceBootstrap`, a service bootstrap on the in-memory Firestore, Realtime Database and Pub/Sub of the platform libraries.
- `lazyApplication`, re-exported from `@emmett-community/emmett-expressjs-with-openapi`, to use the asynchronous `createApp`/`getApplication` with the test helpers of `@event-driven-io/emmett-expressjs`.

### Removed

- **Breaking:** the re-exports of the Express test helpers `ApiSpecification`, `ApiE2ESpecification`, `existingStream`, `expectNewEvents`, `expectResponse` and the type `TestRequest`. A re-export would bring `supertest` back to production. Import them from `@event-driven-io/emmett-expressjs`, installed in `devDependencies`.

### Changed

- `startApi()` closes the HTTP server before the message bus, Firestore and the Firebase app.
- The logger is passed to the message bus as is. The previous adapter inverted the arguments, so every message bus log record was malformed.
- `ctx.eventStore` is wrapped with `asEventStore`, so `readStream` returns `{ events, currentStreamVersion, streamExists }` as Emmett's `EventStore` declares, instead of a plain array.
- The Firestore dependency check reads a query on `_healthcheck` instead of a document, which the in-memory Firestore also supports.
- Depends on `@emmett-community/emmett-google-pubsub` ^0.6.0, `@emmett-community/emmett-google-firestore` ^0.6.0, `@emmett-community/emmett-google-realtime-db` ^0.8.0 and `@emmett-community/emmett-expressjs-with-openapi` ^0.9.0.
- The build splits shared code into a chunk, so the main and testing entries use the same classes.
- Tests use the in-memory fakes of the platform libraries instead of their own key-value fakes.

## [0.3.0] - 2026-01-17

### Added

- Allow `ServiceBootstrapConfig.eventStore.collections` to override the Firestore stream and counter collection names that are passed to `createEventStore`, including new unit coverage and projection wiring safeguards.

### Documentation

- Document the `eventStore.collections` option in the README and add an example configuration snippet showing custom stream/counter collections.

## [0.2.0] - 2026-01-16

### Changed

- Updated the versions of `@emmett-community/emmett-expressjs-with-openapi`, `@emmett-community/emmett-google-firestore`, `@emmett-community/emmett-google-pubsub`, and `@emmett-community/emmett-google-realtime-db` so the bootstrap depends on the latest compatible platform releases.

## [0.1.0] - 2026-01-06

### Added

- Initial release of the service bootstrap that wires Firebase (Firestore, Realtime DB, Auth), Pub/Sub, and lifecycle helpers together with a single `ServiceBootstrap` orchestrator.
- Built-in dependency checks, graceful shutdown helpers, and signal handling support to make bootstrapped apps safe to start and stop.
- Event store and Realtime DB projection wiring plus helper utilities for Firebase, Pub/Sub, and lifecycle management (including in-memory helpers for tests).
- Feature specifications for configuration, dependency management, event store integration, graceful shutdown, observability logging, and service initialization scenarios.
- README documentation, CI workflows, and automated tests spanning unit, integration, and end-to-end layers that exercise the bootstrap flows.

### Changed

- CI build-and-test workflow was constrained to run only on pull requests while keeping the publish pipeline gated behind tags.

[0.2.0]: https://github.com/emmett-community/emmett-google-services-bootstrap/releases/tag/0.2.0
[0.1.0]: https://github.com/emmett-community/emmett-google-services-bootstrap/releases/tag/0.1.0
