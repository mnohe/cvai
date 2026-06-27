import { signOut } from "firebase/auth";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch, ApiError } from "@/lib/api";
import { auth } from "@/lib/firebase";
import type { Account } from "@/lib/types";

const creditPacks = [
  { id: "pack_starter", name: "Starter", credits: 20, price: "$2" },
  { id: "pack_active", name: "Active search", credits: 60, price: "$5" },
  { id: "pack_campaign", name: "Campaign", credits: 150, price: "$10" },
];
const pendingCheckoutSessionKey = "cvai:pendingCheckoutSessionId";

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [account, setAccount] = useState<Account | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [checkoutPack, setCheckoutPack] = useState<string | null>(null);
  const [selectedPack, setSelectedPack] = useState(creditPacks[0].id);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [billingMessage, setBillingMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let refreshTimer: number | undefined;
    setLoadingAccount(true);
    setBillingError(null);
    setBillingMessage(null);

    async function loadAccount(clearCheckoutMessage = false) {
      try {
        const nextAccount = await apiFetch<Account>("/account");
        if (cancelled) return;
        setAccount(nextAccount);
        setBillingAvailable(typeof nextAccount.creditBalance === "number");
        setLoadingAccount(false);
        if (clearCheckoutMessage) setBillingMessage(null);
      } catch {
        if (cancelled) return;
        setAccount(null);
        setBillingAvailable(false);
        setLoadingAccount(false);
      }
    }

    void loadAccount();

    if (searchParams.get("checkout") === "success") {
      setBillingMessage("Stripe is confirming the purchase. Credits will appear shortly.");
      const sessionId = searchParams.get("session_id") ?? window.sessionStorage.getItem(pendingCheckoutSessionKey);
      if (sessionId) {
        void apiFetch<{ processed: boolean }>("/billing/checkout/confirm", {
          method: "POST",
          body: JSON.stringify({ sessionId }),
        })
          .then(() => {
            window.sessionStorage.removeItem(pendingCheckoutSessionKey);
            return loadAccount(true);
          })
          .catch(() => {
            if (!cancelled) {
              setBillingError("Checkout completed, but credits could not be confirmed yet.");
            }
          });
      } else {
        setBillingError("Checkout completed, but the checkout session could not be identified.");
      }
      let attempts = 0;
      refreshTimer = window.setInterval(() => {
        attempts += 1;
        void loadAccount();
        if (attempts >= 10 && refreshTimer !== undefined) {
          window.clearInterval(refreshTimer);
          refreshTimer = undefined;
        }
      }, 3000);
    } else if (searchParams.get("checkout") === "cancelled") {
      setBillingMessage("Checkout was cancelled.");
    }

    return () => {
      cancelled = true;
      if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    };
  }, [searchParams, user?.uid]);

  async function startCheckout(packId: string) {
    setCheckoutPack(packId);
    setBillingError(null);
    try {
      const result = await apiFetch<{ url: string; sessionId?: string }>("/billing/checkout", {
        method: "POST",
        body: JSON.stringify({
          packId,
          successUrl: `${window.location.origin}/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${window.location.origin}/settings?checkout=cancelled`,
        }),
      });
      if (result.sessionId) {
        window.sessionStorage.setItem(pendingCheckoutSessionKey, result.sessionId);
      }
      window.location.assign(result.url);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setBillingError("Billing is not available in this deployment.");
      } else {
        setBillingError("Checkout could not be started.");
      }
      setCheckoutPack(null);
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
        <section className="settings-section billing-settings-section" id="billing">
          <h2>Billing</h2>
          {loadingAccount ? (
            <p className="muted">Loading billing.</p>
          ) : billingAvailable ? (
            <>
              <div className="billing-summary">
                <div>
                  <p className="label">Credit balance</p>
                  <p className="credit-placeholder">{account?.creditBalance ?? 0} credits</p>
                </div>
                <form
                  className="credit-purchase-control"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void startCheckout(selectedPack);
                  }}
                >
                  <select
                    aria-label="Credit pack"
                    value={selectedPack}
                    onChange={(event) => setSelectedPack(event.target.value)}
                  >
                    {creditPacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.credits} credits - {pack.name} - {pack.price}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="primary-rect-button" disabled={checkoutPack !== null}>
                    {checkoutPack ? "Buying..." : "Buy"}
                  </button>
                </form>
              </div>

              {billingMessage && <p className="status-banner neutral">{billingMessage}</p>}
              {billingError && <p className="error-text">{billingError}</p>}
            </>
          ) : (
            <p className="muted">Credit billing is not enabled for this deployment.</p>
          )}
        </section>
        <section className="settings-section account-settings-section">
          <h2>Account</h2>
          <div>
            <p>{user?.displayName || "CVAI user"}</p>
            <p className="muted">{user?.email}</p>
          </div>
          <button
            type="button"
            className="danger-link-button"
            onClick={async () => {
              await signOut(auth);
              navigate("/login", { replace: true });
            }}
          >
            Sign out
          </button>
        </section>
        <section className="settings-section account-settings-section">
          <h2>Privacy</h2>
          <p className="muted">Coming soon</p>
        </section>
      </div>
    </section>
  );
}
