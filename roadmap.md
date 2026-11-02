# Roadmap

Work planned for this library, driven by the rules of the my-f-startup reference architecture. All changes must be backward compatible. Only open items are listed.

| Item | Note |
|---|---|
| Trace propagation through the message bus | The Pub/Sub library publishes and reads the `traceparent` attribute when a tracing SDK is registered. The bootstrap does not register one, and the path has not run end to end with an SDK |
