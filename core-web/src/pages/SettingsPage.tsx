import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { getProviderNames } from "@/lib/auth-providers";
import { auth } from "@/lib/firebase";
import { Slots } from "@/slots";

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const providerNames = getProviderNames(user?.providerData.map((p) => p.providerId) ?? []);

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
          <p className="settings-email-row">
            <span className="muted">{user?.email}</span>
            {providerNames.map((providerName) => (
              <span className="provider-pill" key={providerName}>
                {providerName}
              </span>
            ))}
          </p>
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
        <Slots.SettingsExtra />
        <Slots.PrivacySettings />
      </div>
    </section>
  );
}
