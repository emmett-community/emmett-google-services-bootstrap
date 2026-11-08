import type { NextFunction, Request, Response } from 'express';
import {
  getHealth as health,
  getReady as ready,
} from '../../../../src/bootstrap/probes';
import type { ServiceBootstrapContext } from '../../../../src/bootstrap/ServiceBootstrap';

let readyHandler:
  | ((
      request: Request,
      response: Response,
      next: NextFunction,
    ) => Promise<void>)
  | undefined;

export const initializeHandlers = (ctx: ServiceBootstrapContext): void => {
  readyHandler = ready(ctx);
};

export const getHealth = health;

export const getReady = (
  request: Request,
  response: Response,
  next: NextFunction,
) => readyHandler!(request, response, next);
