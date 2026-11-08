# Roadmap

Work planned for this library. All changes must be backward compatible. Only open items are listed.

| Item | Note |
|---|---|
| Lint and format check in CI | `npm run lint` and `npm run format:check` pass (0.6.0), but `build_and_test` does not run them yet |
| Trace propagation through the message bus | The Pub/Sub library publishes and reads the `traceparent` attribute when a tracing SDK is registered. The bootstrap does not register one, and the path has not run end to end with an SDK |
