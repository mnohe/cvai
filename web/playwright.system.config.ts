import { defineConfig, devices } from "@playwright/test";

// The full-system target boots the real Go backend (built with the
// e2e_mock tag, see functions/cmd/llm_wiring_e2e_mock.go) against the
// Firestore and Auth emulators, instead of intercepting /api/** in the
// browser the way playwright.config.ts's UI-only target does. It uses its
// own web and API ports so it can run alongside — or independently of —
// the UI target without a port clash, and its own report/output
// directories so a failure here is never mistaken for a UI-target failure.
const webPort = process.env.PLAYWRIGHT_SYSTEM_WEB_PORT ?? "5178";
const apiPort = process.env.PLAYWRIGHT_SYSTEM_API_PORT ?? "8092";
const baseURL = `http://127.0.0.1:${webPort}`;
const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-cvai";
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "true";

export default defineConfig({
  testDir: "./e2e-system",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report-system" }],
  ],
  outputDir: "test-results-system",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: [
    {
      // Runs the real backend, not a mock HTTP layer. -tags e2e_mock swaps
      // only the LLM completer for a deterministic in-memory one (see
      // internal/llm/mock); every other route, including account creation
      // in Firestore, is the production code path.
      command:
        `cd ../functions && ` +
        `FIRESTORE_EMULATOR_HOST=${firestoreEmulatorHost} ` +
        `FIREBASE_AUTH_EMULATOR_HOST=${authEmulatorHost} ` +
        `FIREBASE_PROJECT_ID=${projectId} ` +
        `PORT=${apiPort} ` +
        `go run -tags e2e_mock ./cmd`,
      url: `http://127.0.0.1:${apiPort}/healthz`,
      reuseExistingServer,
      timeout: 60_000,
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${webPort}`,
      url: baseURL,
      reuseExistingServer,
      env: {
        VITE_FIREBASE_API_KEY: "demo-api-key",
        VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
        VITE_FIREBASE_PROJECT_ID: projectId,
        VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
        VITE_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
        VITE_FIREBASE_APP_ID: "1:000000000000:web:0000000000000000000000",
        VITE_API_BASE_URL: "/api",
        VITE_USE_EMULATOR: "true",
        VITE_E2E: "true",
        // Points the dev-server proxy at this config's own API port instead
        // of the default 8081 a developer's manually-run backend listens on.
        DEV_API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
