import {
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { auth } from "@/lib/firebase";
import { CriticalFirebasePage } from "@/components/CriticalFirebasePage";
import { RuntimeStatusProvider } from "@/components/RuntimeStatusProvider";
import {
  getFirebaseBackendCheckUrls,
  getFirebaseInitializationError,
} from "@/lib/firebase";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const FIREBASE_BACKEND_RECHECK_MS = 60000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [criticalError, setCriticalError] = useState<Error | null>(
    getFirebaseInitializationError() ?? null,
  );

  useEffect(() => {
    if (criticalError) {
      setLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    async function start() {
      const backendError = await checkFirebaseBackends();
      if (cancelled) return;
      if (backendError) {
        setCriticalError(backendError);
        setLoading(false);
        return;
      }

      unsubscribe = onAuthStateChanged(
        auth,
        (nextUser) => {
          setUser(nextUser);
          setLoading(false);
        },
        (error) => {
          setCriticalError(error);
          setLoading(false);
        },
      );
    }

    void start();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    if (criticalError || getFirebaseBackendCheckUrls().length === 0) return;

    let cancelled = false;
    const interval = window.setInterval(() => {
      void checkFirebaseBackends().then((backendError) => {
        if (!cancelled && backendError) {
          setCriticalError(backendError);
          setLoading(false);
        }
      });
    }, FIREBASE_BACKEND_RECHECK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [criticalError]);

  const value = useMemo(() => ({ user, loading }), [user, loading]);

  if (criticalError) {
    return <CriticalFirebasePage detail={criticalError.message} />;
  }

  return (
    <AuthContext.Provider value={value}>
      <RuntimeStatusProvider enabled={Boolean(user)}>{children}</RuntimeStatusProvider>
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }

  return value;
}

async function checkFirebaseBackends() {
  const urls = getFirebaseBackendCheckUrls();
  if (urls.length === 0) return null;

  try {
    await Promise.all(
      urls.map((url) =>
        fetch(url, {
          cache: "no-store",
        }),
      ),
    );
    return null;
  } catch {
    return new Error("Firebase Auth or Firestore is not reachable.");
  }
}
