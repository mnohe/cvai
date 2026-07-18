import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { useRuntimeStatus } from "@/components/RuntimeStatusProvider";
import { db } from "@/lib/firebase";
import { getCVCompleteness, normaliseCV } from "@/lib/cv";
import type { Candidate } from "@/lib/types";
import { Slots } from "@/slots";

export function AccountPanel({
  flashStatusToken,
  onClose,
}: {
  flashStatusToken?: number;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { backendIssueActive, backendIssueMessage } = useRuntimeStatus();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Partial<Candidate> | null>(null);
  const [statusFlashing, setStatusFlashing] = useState(false);

  useEffect(() => {
    if (!user) {
      setCandidate(null);
      return;
    }

    return onSnapshot(
      doc(db, "users", user.uid, "candidate", "profile"),
      (snapshot) => {
        setCandidate(snapshot.exists() ? ({ id: user.uid, ...snapshot.data() } as Partial<Candidate>) : null);
      },
      () => {
        setCandidate(null);
      },
    );
  }, [user]);

  useEffect(() => {
    if (!backendIssueActive) return;
    setStatusFlashing(false);
    const start = window.setTimeout(() => setStatusFlashing(true), 0);
    const stop = window.setTimeout(() => setStatusFlashing(false), 1400);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(stop);
    };
  }, [backendIssueActive, flashStatusToken]);

  if (!user) {
    return null;
  }

  const cvCompleteness = getCVCompleteness(normaliseCV(candidate));

  return (
    <div className="account-panel">
      <div className="account-panel-backdrop" onClick={onClose} />
      <section
        className="account-panel-card"
        role="dialog"
        aria-label="Account panel"
        aria-modal="true"
      >
        <div className="panel-row">
          <div>
            <h2>{user.displayName || "CVAI user"}</h2>
            <p className="muted">{user.email || "No email available"}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close">
            &gt;&gt;
          </button>
        </div>

        <div className="account-panel-content">
          {backendIssueActive && (
            <div
              className={`panel-section account-status-section ${statusFlashing ? "account-status-flash" : ""}`}
              role="status"
              aria-live="polite"
            >
              <p className="label account-status-critical">Status</p>
              <p>{backendIssueMessage}</p>
            </div>
          )}

          <div className="panel-section">
            <p className="label">Profile</p>
            <a
              className="account-cv-completeness"
              href="/profile/cv"
              onClick={(event) => {
                event.preventDefault();
                onClose();
                navigate("/profile/cv", { state: { openCompletionPanel: Date.now() } });
              }}
            >
              <div className="cv-completeness-copy">
                <strong>{cvCompleteness.percent}%</strong>
                <span className="muted">
                  {cvCompleteness.complete} of {cvCompleteness.total} section signals
                </span>
              </div>
              <div
                className="cv-progress"
                role="progressbar"
                aria-label="CV completeness"
                aria-valuenow={cvCompleteness.percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <span style={{ width: `${cvCompleteness.percent}%` }} />
              </div>
            </a>
          </div>

          <Slots.AccountPanelExtra />
        </div>

        <div className="panel-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onClose();
              navigate("/settings");
            }}
          >
            Settings
          </button>
        </div>
      </section>
    </div>
  );
}
