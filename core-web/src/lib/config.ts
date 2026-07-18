import { setApiErrorHandler, type ApiErrorHandler } from "@/lib/api";

export function configureCoreWeb(options: { apiErrorHandler?: ApiErrorHandler } = {}) {
  setApiErrorHandler(options.apiErrorHandler);
}
