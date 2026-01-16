# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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
