export type BackendIssueReason = "api_unavailable" | "llm_unavailable" | "llm_disabled";
export interface BackendIssue {
  reason: BackendIssueReason;
}

type ApiConnectivityListener = (issue: BackendIssue | null) => void;

const listeners = new Set<ApiConnectivityListener>();
let currentIssue: BackendIssue | null = null;

export function subscribeApiConnectivity(listener: ApiConnectivityListener) {
  listeners.add(listener);
  listener(currentIssue);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyApiAvailable() {
  setBackendIssue(null);
}

export function notifyApiUnavailable() {
  setBackendIssue({ reason: "api_unavailable" });
}

export function notifyLlmUnavailable() {
  setBackendIssue({ reason: "llm_unavailable" });
}

export function notifyLlmDisabled() {
  setBackendIssue({ reason: "llm_disabled" });
}

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? "/api";
}

function setBackendIssue(issue: BackendIssue | null) {
  if (currentIssue?.reason === issue?.reason) return;
  currentIssue = issue;
  for (const listener of listeners) {
    listener(issue);
  }
}
