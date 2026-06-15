import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { ProfileCompletionMeter } from "@/components/ProfileCompletionMeter";
import { auth, db } from "@/lib/firebase";
import { apiFetch } from "@/lib/api";
import type { Account } from "@/lib/types";

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setCreditBalance(null);
      return;
    }

    let bootstrapped = false;
    const ref = doc(db, "users", user.uid, "account", "profile");

    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setCreditBalance((snap.data() as Account).credit_balance);
        } else if (!bootstrapped) {
          // Account document not yet created — trigger the backend to initialise it.
          bootstrapped = true;
          void apiFetch<Account>("/account").catch(() => {});
        }
      },
      () => {
        setCreditBalance(null);
      },
    );

    return unsub;
  }, [user]);

  if (!user) {
    return null;
  }

  const providerNames = getProviderNames(user.providerData.map((p) => p.providerId));

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

        <div className="panel-section md:hidden">
          <p className="label">Profile</p>
          <ProfileCompletionMeter />
        </div>

        <div className="panel-section">
          <p className="label">Connected providers</p>
          <p>{providerNames.length > 0 ? providerNames.join(", ") : "Firebase Auth"}</p>
        </div>

        <div className="panel-section">
          <p className="label">Billing</p>
          <p className="muted">Credits</p>
          <p className="credit-balance" aria-label="Credit balance">
            {creditBalance === null ? "—" : creditBalance}
          </p>
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
    if (providerId === "password") return "Google";
    return providerId;
  });
}
