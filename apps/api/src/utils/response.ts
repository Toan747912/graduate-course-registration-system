import type { Response } from 'express';

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { ok: true, data };
  res.status(status).json(body);
}

export function sendError(res: Response, status: number, code: string, message: string, details?: unknown): void {
  const body: ApiError = { ok: false, error: { code, message, details } };
  res.status(status).json(body);
}
