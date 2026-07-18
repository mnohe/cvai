import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogoMark } from "@/components/LogoMark";
import { useAuth } from "@/components/AuthProvider";
import { auth, db, githubProvider, googleProvider } from "@/lib/firebase";
import { getProfileCompletion } from "@/lib/profileCompletion";
import type { Candidate } from "@/lib/types";

export function LoginPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<"Google" | "GitHub" | null>(
    null,
  );

  useEffect(() => {
    if (!loading && user) {
      void navigateAfterSignIn(user.uid, navigate);
    }
  }, [loading, navigate, user]);

  async function handleSignIn(providerName: "Google" | "GitHub") {
    setError(null);
    setBusyProvider(providerName);
    try {
      const credential =
        import.meta.env.VITE_E2E === "true"
          ? await signInForE2E(providerName)
          : await signInWithPopup(
              auth,
              providerName === "Google" ? googleProvider : githubProvider,
            );

      await navigateAfterSignIn(credential.user.uid, navigate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in");
    } finally {
      setBusyProvider(null);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <div className="login-brand-mark">
            <LogoMark variant="side" />
          </div>
          <div className="login-brand-copy">
            <h1>Sign in</h1>
            <p className="muted">
              Build your profile, track applications, and prepare every role from one workspace.
            </p>
            <div className="login-actions">
              <button
                type="button"
                className="primary-rect-button"
                onClick={() => void handleSignIn("Google")}
                disabled={busyProvider !== null}
              >
                {busyProvider === "Google" ? "Signing in..." : "Sign in with Google"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleSignIn("GitHub")}
                disabled={busyProvider !== null}
              >
                {busyProvider === "GitHub" ? "Signing in..." : "Sign in with GitHub"}
              </button>
            </div>
          </div>
        </div>
        {error && <p className="form-error">{error}</p>}
      </section>
    </main>
  );
}

async function navigateAfterSignIn(
  uid: string,
  navigate: ReturnType<typeof useNavigate>,
) {
  const destination = await getPostAuthDestination(uid);
  navigate(destination, { replace: true });
}

async function getPostAuthDestination(uid: string): Promise<"/profile/cv" | "/dashboard"> {
  if (
    import.meta.env.VITE_E2E === "true" &&
    window.localStorage.getItem("cvai:e2eReturning") === "true"
  ) {
    return "/dashboard";
  }

  try {
    const snapshot = await getDoc(doc(db, "users", uid, "candidate", "profile"));
    if (!snapshot.exists()) {
      return "/profile/cv";
    }

    const completion = getProfileCompletion(
      snapshot.data() as Partial<Candidate>,
    );
    return completion.segments[0]?.complete ? "/dashboard" : "/profile/cv";
  } catch {
    return "/profile/cv";
  }
}

async function signInForE2E(providerName: "Google" | "GitHub") {
  const returning = window.localStorage.getItem("cvai:e2eReturning") === "true";
  const email =
    window.localStorage.getItem("cvai:e2eEmail") ??
    (returning ? "returning.user@example.test" : "new.user@example.test");
  const password = "CorrectHorseBatteryStaple123!";
  const displayName = returning ? "Returning User" : "New User";
  window.localStorage.setItem("cvai:e2eProvider", providerName);

  try {
    return await signInWithEmailAndPassword(auth, email, password);
  } catch {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName });
    return credential;
  }
}
