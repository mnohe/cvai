import { auth } from "@/lib/firebase";
import {
  notifyApiUnavailable,
  notifyLlmDisabled,
  notifyLlmUnavailable,
} from "@/lib/api-connectivity";

export { ApiError, getApiErrorMessage, getFailureReason, setApiErrorHandler } from "@/lib/api-errors";
export type { ApiErrorHandler, ApiFailureReason } from "@/lib/api-errors";

import { ApiError } from "@/lib/api-errors";

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (options.body && !(options.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  const timeout = createTimeoutSignal();
  try {
    response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? "/api"}${path}`, {
      ...options,
      headers,
      signal: mergeSignals(options.signal, timeout.signal),
    });
  } catch (error) {
    notifyApiUnavailable();
    throw error;
  } finally {
    timeout.cancel();
  }

  if (!response.ok) {
    const body = await readResponseBody(response);
    if (isBackendUnavailableResponse(response, body)) {
      notifyApiUnavailable();
    }
    const apiError = new ApiError(response.status, body);
    if (apiError.reason === "llm_unavailable") {
      notifyLlmUnavailable();
    }
    if (apiError.reason === "llm_disabled") {
      notifyLlmDisabled();
    }
    throw apiError;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  try {
    const body = (await response.json()) as T;
    return body;
  } catch (error) {
    notifyApiUnavailable();
    throw error;
  }
}

function createTimeoutSignal() {
  const controller = new AbortController();
  const timeoutMs = Number(import.meta.env.VITE_API_REQUEST_TIMEOUT_MS ?? "15000");
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(timer),
  };
}

function mergeSignals(primary: AbortSignal | null | undefined, timeout: AbortSignal) {
  if (!primary) return timeout;
  if (primary.aborted) return primary;

  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isBackendUnavailableResponse(response: Response, body: unknown) {
  if ([502, 503, 504].includes(response.status)) return true;
  const contentType = response.headers.get("Content-Type") ?? "";
  if (response.status >= 500 && !contentType.includes("application/json")) return true;
  return typeof body === "string" && /ECONNREFUSED|proxy error|backend/i.test(body);
}
