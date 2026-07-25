import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { sendError } from '../utils/response.js';

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.path}`);
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    sendError(res, 400, 'VALIDATION_ERROR', 'Request validation failed', err.flatten());
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('Unhandled error:', err);
  sendError(res, 500, 'INTERNAL_ERROR', message);
}
