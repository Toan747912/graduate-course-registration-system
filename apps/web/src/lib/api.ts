import { supabase } from './supabaseClient';
import type { ApiErrorBody, ApiSuccessBody } from '../types/api';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

/** Thrown for any non-success API response, carrying the backend's own error code/message/reason. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Thin fetch wrapper that attaches the current Supabase session's access
 * token as a bearer token. All business operations go through apps/api, never
 * directly against Supabase tables from the browser. Returns the unwrapped
 * `data` payload on success; throws ApiRequestError on failure.
 */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  const body = (await response.json()) as ApiSuccessBody<T> | ApiErrorBody;

  if (!response.ok || !body.ok) {
    const errorBody = body as ApiErrorBody;
    throw new ApiRequestError(
      response.status,
      errorBody.error?.code ?? 'UNKNOWN_ERROR',
      errorBody.error?.message ?? `Yêu cầu tới ${path} thất bại (HTTP ${response.status})`,
      errorBody.error?.details,
    );
  }

  return body.data;
}
