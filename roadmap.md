# Roadmap

Work planned for this library. All changes must be backward compatible. Only open items are listed.

| Item | Note |
|---|---|
| Read models left behind until the next append | The Firestore event store and the Realtime Database projections cannot share a transaction, so a process that stops between the commit and the projection leaves the read models of that stream behind. The projections apply the missed events with the next append of the stream, so the gap is never permanent, but a stream that gets no new append stays behind. Designed and left for later because the case is rare (the process must die in the milliseconds between the two writes, and a graceful shutdown lets requests in flight finish): in the transaction of the append, a mark per stream in a Firestore collection, written through the store hook; removed once the projections are written, only when no later append rewrote it; a recovery run, called by the same scheduled job route as the outbox, calls `projectStream` for the marks older than a minimum age and removes them. Cost: one more write, one read and one delete per append, plus the run |
