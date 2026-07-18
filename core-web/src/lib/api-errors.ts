export type ApiFailureReason =
  | "llm_unavailable"
  | "rate_limited"
  | "insufficient_credits"
  | "llm_disabled"
  | (string & {});

export type ApiErrorHandler = (error: ApiError) => string | null | undefined;

let apiErrorHandler: ApiErrorHandler | undefined;

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly reason?: ApiFailureReason;

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    this.reason = getFailureReason(body);
  }
}

export function setApiErrorHandler(handler?: ApiErrorHandler) {
  apiErrorHandler = handler;
}

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof ApiError)) return fallback;

  if (error.reason === "llm_unavailable") {
    return "The AI service is temporarily unavailable. Try again shortly.";
  }
  if (error.reason === "rate_limited") {
    return "Too many requests were made at once. Try again shortly.";
  }

  return apiErrorHandler?.(error) ?? fallback;
}

export function getFailureReason(body: unknown): ApiFailureReason | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const reason = record.reason ?? record.code;
  if (typeof reason === "string") return reason as ApiFailureReason;
  const error = record.error;
  if (error && typeof error === "object") {
    const nested = (error as Record<string, unknown>).reason ?? (error as Record<string, unknown>).code;
    if (typeof nested === "string") return nested as ApiFailureReason;
  }
  return undefined;
}
