import { signOut } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/api";
import { auth, db } from "@/lib/firebase";
import type { Account } from "@/lib/types";

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creditBalance, setCreditBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setCreditBalance(null);
      return;
    }

    let bootstrapped = false;
    return onSnapshot(
      doc(db, "users", user.uid, "account", "profile"),
      (snapshot) => {
        if (snapshot.exists()) {
          setCreditBalance((snapshot.data() as Account).credit_balance);
        } else if (!bootstrapped) {
          bootstrapped = true;
          void apiFetch<Account>("/account").catch(() => {});
        }
      },
      () => setCreditBalance(null),
    );
  }, [user]);

  return (
    <section className="page-stack">
      <div className="page-header">
        <div>
          <h1>Settings</h1>
        </div>
      </div>
      <div className="settings-grid">
        <section className="settings-section">
          <h2>Account</h2>
          <p>{user?.displayName || "CVAI user"}</p>
          <p className="muted">{user?.email}</p>
          <button
            type="button"
            className="danger-button"
            onClick={async () => {
              await signOut(auth);
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </button>
        </section>
        <section className="settings-section">
          <h2>Billing</h2>
          <p className="label">Credits</p>
          <p className="credit-placeholder" aria-label="Credit balance">
            {creditBalance === null ? "—" : creditBalance}
          </p>
        </section>
        <section className="settings-section">
          <h2>Privacy</h2>
          <p className="muted">Coming soon</p>
        </section>
      </div>
    </section>
  );
}
