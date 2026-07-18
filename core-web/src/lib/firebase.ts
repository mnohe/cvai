import { initializeApp } from "firebase/app";
import type { FirebaseApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
  type Auth,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let firebaseInitializationError: Error | undefined;

export let app: FirebaseApp = unavailableFirebaseObject("Firebase app") as FirebaseApp;
export let auth: Auth = unavailableFirebaseObject("Firebase Auth") as Auth;
export let db: Firestore = unavailableFirebaseObject("Firestore") as Firestore;

export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
} catch (error) {
  firebaseInitializationError = error instanceof Error ? error : new Error("Firebase could not be initialized.");
}

if (!firebaseInitializationError && import.meta.env.VITE_USE_EMULATOR === "true") {
  const authEmulatorUrl =
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? "http://localhost:9099";
  const firestoreEmulatorHost =
    import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? "localhost";
  const firestoreEmulatorPort = Number(
    import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? "8080",
  );

  connectAuthEmulator(auth, authEmulatorUrl, {
    disableWarnings: true,
  });
  connectFirestoreEmulator(db, firestoreEmulatorHost, firestoreEmulatorPort);
}

export function getFirebaseInitializationError() {
  return firebaseInitializationError;
}

export function getFirebaseBackendCheckUrls() {
  if (import.meta.env.VITE_USE_EMULATOR !== "true") return [];
  const authHealthUrl = import.meta.env.VITE_FIREBASE_AUTH_HEALTH_URL;
  const firestoreHealthUrl = import.meta.env.VITE_FIRESTORE_HEALTH_URL;
  if (authHealthUrl && firestoreHealthUrl) {
    return [authHealthUrl, firestoreHealthUrl];
  }
  const authEmulatorUrl =
    import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL ?? "http://localhost:9099";
  const firestoreEmulatorHost =
    import.meta.env.VITE_FIRESTORE_EMULATOR_HOST ?? "localhost";
  const firestoreEmulatorPort =
    import.meta.env.VITE_FIRESTORE_EMULATOR_PORT ?? "8080";
  return [
    authEmulatorUrl,
    `http://${firestoreEmulatorHost}:${firestoreEmulatorPort}`,
  ];
}

function unavailableFirebaseObject(label: string) {
  return new Proxy(
    {},
    {
      get() {
        throw firebaseInitializationError ?? new Error(`${label} is unavailable.`);
      },
    },
  );
}
