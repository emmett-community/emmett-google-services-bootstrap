import { HttpResponse, OK, on } from '@emmett-community/emmett-expressjs-with-openapi';
import type { ServiceBootstrapContext } from './ServiceBootstrap';

/**
 * Handler for `GET /health` (liveness): the process is up and serving requests.
 * Wire it to the `getHealth` operation of the service contract.
 */
export const getHealth = on(async () => OK({ body: { status: 'ok' } }));

/**
 * Handler for `GET /ready` (readiness): answers 200 when the stores, the message bus and the
 * configured dependencies answer, and 503 with the failed checks otherwise.
 * Wire it to the `getReady` operation of the service contract.
 */
export const getReady = (ctx: Pick<ServiceBootstrapContext, 'checkReadiness'>) =>
  on(async () => {
    const summary = await ctx.checkReadiness();
    const checks = summary.results.map((result) => ({
      name: result.name,
      ok: result.ok,
    }));

    return summary.ok
      ? OK({ body: { status: 'ready', checks } })
      : HttpResponse(503, { body: { status: 'unavailable', checks } });
  });
