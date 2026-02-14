import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from './errors';
import { logger } from '../logger';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number') {
    const message = 'message' in err && typeof err.message === 'string' ? err.message : 'Bad request';
    res.status(err.status).json({
      error: 'request_error',
      message
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation_error',
      message: 'Request validation failed',
      details: err.flatten()
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.statusCode).json({
      error: 'http_error',
      message: err.message
    });
    return;
  }

  logger.error({ err, requestId: req.requestId }, 'Unhandled error');
  res.status(500).json({
    error: 'internal_error',
    message: 'Internal server error'
  });
}
