import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  type BackendIssue,
  getApiBaseUrl,
  notifyApiAvailable,
  notifyApiUnavailable,
  subscribeApiConnectivity,
} from "@/lib/api-connectivity";

interface RuntimeStatusContextValue {
  backendIssue: BackendIssue | null;
  backendIssueActive: boolean;
  backendIssueMessage: string | null;
}

const RuntimeStatusContext = createContext<RuntimeStatusContextValue | undefined>(undefined);
const API_RECOVERY_POLL_MS = 10000;
const API_HEALTH_TIMEOUT_MS = 5000;

export function RuntimeStatusProvider({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const [backendIssue, setBackendIssue] = useState<BackendIssue | null>(null);

  useEffect(() => {
    return subscribeApiConnectivity(setBackendIssue);
  }, []);

  useEffect(() => {
    if (!enabled) {
      notifyApiAvailable();
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function checkInitialHealth() {
      const timeout = createTimeoutSignal(API_HEALTH_TIMEOUT_MS);
      try {
        const response = await fetch(`${getApiBaseUrl()}/healthz`, {
          cache: "no-store",
          signal: timeout.signal,
        });
        if (!cancelled) {
          if (response.ok) {
            notifyApiAvailable();
          } else {
            notifyApiUnavailable();
          }
        }
      } catch {
        if (!cancelled) {
          notifyApiUnavailable();
        }
      } finally {
        timeout.cancel();
      }
    }

    void checkInitialHealth();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || backendIssue?.reason !== "api_unavailable") return;

    let cancelled = false;
    const check = async () => {
      const timeout = createTimeoutSignal(API_HEALTH_TIMEOUT_MS);
      try {
        const response = await fetch(`${getApiBaseUrl()}/healthz`, {
          cache: "no-store",
          signal: timeout.signal,
        });
        if (!cancelled) {
          if (response.ok) {
            notifyApiAvailable();
          } else {
            notifyApiUnavailable();
          }
        }
      } catch {
        if (!cancelled) {
          notifyApiUnavailable();
        }
      } finally {
        timeout.cancel();
      }
    };

    void check();
    const interval = window.setInterval(() => void check(), API_RECOVERY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [backendIssue?.reason, enabled]);

  const value = useMemo(
    () => ({
      backendIssue: enabled ? backendIssue : null,
      backendIssueActive: enabled && Boolean(backendIssue),
      backendIssueMessage: enabled ? getBackendIssueMessage(backendIssue) : null,
    }),
    [backendIssue, enabled],
  );

  return (
    <RuntimeStatusContext.Provider value={value}>
      {children}
    </RuntimeStatusContext.Provider>
  );
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cancel: () => window.clearTimeout(timer),
  };
}

function getBackendIssueMessage(issue: BackendIssue | null) {
  if (!issue) return null;
  if (issue.reason === "llm_unavailable") {
    return "The AI service is temporarily unavailable. Some AI actions may fail until it is back online.";
  }
  if (issue.reason === "llm_disabled") {
    return "AI actions are currently disabled. Some AI actions may fail until service is restored.";
  }
  return "Some services are not responding, and the features they support are unavailable. Help is on the way.";
}

export function useRuntimeStatus() {
  const value = useContext(RuntimeStatusContext);
  if (!value) {
    throw new Error("useRuntimeStatus must be used within RuntimeStatusProvider");
  }
  return value;
}
