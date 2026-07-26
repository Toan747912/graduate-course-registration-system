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

  console.error('Unhandled error:', err);

  // Unlike the explicit sendError(...) calls in routes/*.ts (which forward
  // known Postgres constraint/RPC business messages that are meant to be
  // shown to the user), an error reaching this fallback handler is by
  // definition unexpected, so its raw message may contain internal detail
  // (driver/network/internal path info). Never forward it to the client.
  const message =
    process.env.NODE_ENV === 'production'
      ? 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.'
      : err instanceof Error
        ? err.message
        : 'Unexpected error';
  sendError(res, 500, 'INTERNAL_ERROR', message);
}
