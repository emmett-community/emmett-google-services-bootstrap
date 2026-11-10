import type { AddressInfo } from 'node:net';
import express from 'express';
import { getTracingShutdown } from '../../../src/tracing/shutdown';

// An Express app imported as an ES module, as a service does: one request, then the spans are
// flushed and the process exits
const app = express();
app.get('/orders/:orderId', (_req, res) => {
  res.json({ ok: true });
});

const server = app.listen(0, () => {
  const { port } = server.address() as AddressInfo;
  void fetch(`http://127.0.0.1:${port}/orders/order-1`)
    .then((response) => response.text())
    .then(() => {
      server.close();
      return getTracingShutdown()?.();
    })
    .then(() => process.exit(0));
});
