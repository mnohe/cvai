import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { auth, db } from "@/lib/firebase";
import { getCVCompleteness, normaliseCV } from "@/lib/cv";
import type { Candidate } from "@/lib/types";

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<Partial<Candidate> | null>(null);

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

  if (!user) {
    return null;
  }

  const providerNames = getProviderNames(user.providerData.map((p) => p.providerId));
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
            ×
          </button>
        </div>

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

        <div className="panel-section">
          <p className="label">Connected providers</p>
          <p>{providerNames.length > 0 ? providerNames.join(", ") : "Firebase Auth"}</p>
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
          <button
            type="button"
            className="danger-button"
            onClick={async () => {
              await signOut(auth);
              onClose();
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

function getProviderNames(providerIds: string[]) {
  if (import.meta.env.VITE_E2E === "true") {
    const provider = window.localStorage.getItem("cvai:e2eProvider");
    if (provider) return [provider];
  }

  return providerIds.map((providerId) => {
    if (providerId === "google.com") return "Google";
    if (providerId === "github.com") return "GitHub";
    if (providerId === "password") return "Email / password";
    return providerId;
  });
}
