import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { auth } from "@/lib/firebase";

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

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
          <h2>Privacy</h2>
          <p className="muted">Coming soon</p>
        </section>
      </div>
    </section>
  );
}
