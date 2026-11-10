import type { Event } from '@event-driven-io/emmett';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { ServiceBootstrap } from '../../../src/bootstrap/ServiceBootstrap';

// A request appends an event that goes through the outbox to Pub/Sub, and its subscriber appends
// another event; then the bootstrap shuts down, which flushes the spans, and the process exits
const bootstrap = new ServiceBootstrap({
  serviceName: 'tracing-messaging',
  outbox: { types: ['OrderPlaced'] },
});
const ctx = await bootstrap.initialize();

let markHandled: () => void = () => undefined;
const handled = new Promise<void>((resolve) => {
  markHandled = resolve;
});

ctx.messageBus.subscribe(async (event: Event) => {
  await ctx.eventStore.appendToStream('shipment-1', [
    { type: 'OrderShipped', data: event.data },
  ]);
  markHandled();
}, 'OrderPlaced');
await ctx.messageBus.start();

const app = express();
app.post('/orders/:orderId', (req, res, next) => {
  ctx.eventStore
    .appendToStream(`order-${req.params.orderId}`, [
      { type: 'OrderPlaced', data: { orderId: req.params.orderId } },
    ])
    .then(() => res.status(204).end())
    .catch(next);
});

const server = app.listen(0, () => {
  const { port } = server.address() as AddressInfo;
  void fetch(`http://127.0.0.1:${port}/orders/order-1`, { method: 'POST' })
    .then(() =>
      Promise.race([
        handled,
        new Promise((resolve) => setTimeout(resolve, 20000)),
      ]),
    )
    .then(() => {
      server.close();
      return bootstrap.shutdown('fixture done', 0);
    });
});
