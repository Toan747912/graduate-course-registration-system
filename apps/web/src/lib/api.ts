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
const REQUEST_TIMEOUT_MS = 30_000;

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: init.signal ?? timeoutController.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiRequestError(0, 'TIMEOUT', 'Yêu cầu quá thời gian chờ. Vui lòng thử lại.');
    }
    throw new ApiRequestError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.');
  } finally {
    clearTimeout(timeoutId);
  }

  let body: ApiSuccessBody<T> | ApiErrorBody;
  try {
    body = (await response.json()) as ApiSuccessBody<T> | ApiErrorBody;
  } catch {
    throw new ApiRequestError(
      response.status,
      'INVALID_RESPONSE',
      'Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại sau.',
    );
  }

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
