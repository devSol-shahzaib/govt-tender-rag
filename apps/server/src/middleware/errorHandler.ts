import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger.js';
import { AppError, ValidationError } from '../utils/AppError.js';

/** Falls back to the shared logger for errors raised before the request logger runs. */
function loggerFor(req: Request) {
  return req.log ?? logger;
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // Express identifies an error handler by its arity, so this stays even though it is
  // unused. Removing it silently turns this into ordinary middleware that never runs.
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    // Client faults are routine, so they are logged without a stack trace to keep
    // genuine server faults visible at error level.
    loggerFor(req).warn(
      { statusCode: err.statusCode, type: err.name, reason: err.message },
      'Request rejected',
    );

    res.status(err.statusCode).json({
      success: false,
      error: err.message,
      ...(err instanceof ValidationError && err.details ? { details: err.details } : {}),
    });
    return;
  }

  loggerFor(req).error({ err }, 'Unhandled error');

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    // Lets a user quote an id from a failure that reveals nothing else. pino-http
    // types req.id loosely, so it is narrowed rather than stringified blind.
    requestId: typeof req.id === 'string' ? req.id : '',
  });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ success: false, error: 'Route not found' });
}
