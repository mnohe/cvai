import { signOut } from "firebase/auth";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { getProviderNames } from "@/lib/auth-providers";
import { auth } from "@/lib/firebase";
import { Slots } from "@/slots";

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const providerNames = getProviderNames(user?.providerData.map((p) => p.providerId) ?? []);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSignOutError(null);
    setSigningOut(true);
    try {
      await signOut(auth);
      navigate("/login", { replace: true });
    } catch {
      setSignOutError("Unable to sign out. Please try again.");
      setSigningOut(false);
    }
  }

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
          <div className="account-identity-row">
            <div className="account-identity">
              <p>{user?.displayName || "CVAI user"}</p>
              <p className="settings-email-row">
                <span className="muted">{user?.email}</span>
                {providerNames.map((providerName) => (
                  <span className="provider-pill" key={providerName}>
                    {providerName}
                  </span>
                ))}
              </p>
            </div>
            <button
              type="button"
              className="danger-button account-signout-button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
            >
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
          {signOutError && (
            <p className="form-error" role="alert">
              {signOutError}
            </p>
          )}
        </section>
        <Slots.SettingsExtra />
        <Slots.PrivacySettings />
      </div>
    </section>
  );
}
