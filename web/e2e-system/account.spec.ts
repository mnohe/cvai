import { expect, test } from "@playwright/test";

// This target's job is to prove the full-system harness itself: a real
// browser-facing request reaches the real Go backend, through the real
// Firestore and Auth emulators, with nothing intercepted. It deliberately
// does not use page.route() the way the UI-only suite (../e2e/*.spec.ts)
// does. Deeper real-backend flows (CV import, billing) belong to the task
// that depends on this one, not here.

const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";

test.describe("full-system harness", () => {
  test("the real backend serves a freshly created account through the Firestore emulator", async ({
    request,
    baseURL,
  }) => {
    const email = `system-${Date.now()}@example.test`;
    const signUp = await request.post(
      `http://${authEmulatorHost}/www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=fake-api-key`,
      { data: { email, password: "password123", returnSecureToken: true } },
    );
    expect(signUp.ok()).toBeTruthy();
    const { idToken } = await signUp.json();

    const response = await request.get(`${baseURL}/api/account`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    expect(response.status()).toBe(200);

    // domain.Account has no json tags, so json.Encode uses Go field names.
    const account = await response.json();
    expect(account.CreditBalance).toBe(0);
    expect(account.HasEverPurchased).toBe(false);
  });

  test("a request without a token is rejected by the real backend", async ({ baseURL, request }) => {
    const response = await request.get(`${baseURL}/api/account`);
    expect(response.status()).toBe(401);
  });
});
