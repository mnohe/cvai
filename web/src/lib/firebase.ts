import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  GoogleAuthProvider,
  GithubAuthProvider,
} from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const googleProvider = new GoogleAuthProvider();
export const githubProvider = new GithubAuthProvider();

if (import.meta.env.VITE_USE_EMULATOR === "true") {
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
