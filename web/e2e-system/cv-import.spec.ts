import { expect, test } from "@playwright/test";

// Proves the real asynchronous CV import pipeline end to end: a real PDF
// upload through the real Go backend, a scripted response from the
// deterministic mock LLM completer (E2E-19CF), and the resulting candidate
// profile and credit balance persisted through the real Firestore emulator.
// Browser-mocked coverage of the same flow lives in ../e2e/cv.spec.ts; this
// spec exists to prove the real backend wiring those mocks assume, so it
// talks to the backend directly rather than through the app UI.

const authEmulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080";
const projectId = process.env.FIREBASE_PROJECT_ID ?? "demo-cvai";
const apiPort = process.env.PLAYWRIGHT_SYSTEM_API_PORT ?? "8092";
const apiBaseURL = `http://127.0.0.1:${apiPort}`;

// looksLikePDF only checks the declared part Content-Type plus a "%PDF"
// byte prefix — see functions/internal/handlers/import_cv.go.
const minimalPDF = Buffer.from("%PDF-1.4\n%%EOF");
const candidatePreferences = "Remote-first roles; privacy-boundary-preference-marker";

function scriptedCV() {
  return {
    summary: "Analytical engineer.",
    contact: {
      name: "Ada",
      surname: "Lovelace",
      phone: { prefix: "+44", number: "123456" },
      email: "ada@example.test",
      links: [{ label: "LinkedIn", url: "https://linkedin.example/ada" }],
    },
    skills: ["Go"],
    languages: [{ name: "English", level: "Native" }],
    certifications: [],
    education: [{ name: "Mathematics", type: "Degree", issuer: "University", year: 2020 }],
    experience: [
      {
        company: "Engines Ltd",
        positions: [{ id: "p1", roles: ["Engineer"], start: "2021", location: "London", tasks: ["Built systems"] }],
      },
    ],
    projects: { items: [] },
  };
}

async function signUp(request: import("@playwright/test").APIRequestContext, email: string) {
  const response = await request.post(
    `http://${authEmulatorHost}/www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=fake-api-key`,
    { data: { email, password: "password123", returnSecureToken: true } },
  );
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return { idToken: body.idToken as string, uid: body.localId as string };
}

// Seeds a starting credit balance directly through the Firestore emulator's
// REST API, authorised as the account owner — the same pattern ../e2e/cv.spec.ts
// uses for the candidate and actions documents. There is no HTTP route to
// grant credits in this (open-core) backend; that only exists in CVirgil.
async function seedCredit(request: import("@playwright/test").APIRequestContext, uid: string, idToken: string, balance: number) {
  const response = await request.patch(
    `http://${firestoreEmulatorHost}/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/account/profile`,
    {
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      data: {
        fields: {
          uid: { stringValue: uid },
          credit_balance: { integerValue: String(balance) },
          has_ever_purchased: { booleanValue: false },
          created_at: { timestampValue: new Date().toISOString() },
          updated_at: { timestampValue: new Date().toISOString() },
        },
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function seedCandidatePreferences(
  request: import("@playwright/test").APIRequestContext,
  uid: string,
  idToken: string,
) {
  const response = await request.patch(
    `http://${firestoreEmulatorHost}/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/candidate/profile?updateMask.fieldPaths=preferences`,
    {
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      data: { fields: { preferences: { stringValue: candidatePreferences } } },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function getFirestoreDoc(request: import("@playwright/test").APIRequestContext, uid: string, relativePath: string, idToken: string) {
  return request.get(
    `http://${firestoreEmulatorHost}/v1/projects/${projectId}/databases/(default)/documents/users/${uid}/${relativePath}`,
    { headers: { Authorization: `Bearer ${idToken}` } },
  );
}

async function pollActionStatus(request: import("@playwright/test").APIRequestContext, uid: string, actionId: string, idToken: string, want: string) {
  await expect
    .poll(
      async () => {
        const doc = await getFirestoreDoc(request, uid, `actions/${actionId}`, idToken);
        if (doc.status() !== 200) return null;
        const body = await doc.json();
        return body.fields?.status?.stringValue ?? null;
      },
      { timeout: 15_000, message: `waiting for action ${actionId} to reach status ${want}` },
    )
    .toBe(want);
}

test.describe("CV import — full system", () => {
  test("a PDF upload, scripted mock LLM response, and the resulting candidate profile all go through the real backend", async ({ request }) => {
    const { idToken, uid } = await signUp(request, `cv-import-${Date.now()}@example.test`);
    await seedCredit(request, uid, idToken, 1);
    await seedCandidatePreferences(request, uid, idToken);

    const enqueue = await request.post(`${apiBaseURL}/e2e/mock-llm/responses`, {
      data: { uid, body: scriptedCV() },
    });
    expect(enqueue.status()).toBe(204);

    const upload = await request.post(`${apiBaseURL}/cv/imports`, {
      headers: { Authorization: `Bearer ${idToken}` },
      multipart: { pdf: { name: "cv.pdf", mimeType: "application/pdf", buffer: minimalPDF } },
    });
    expect(upload.status()).toBe(202);
    const { actionId } = await upload.json();
    expect(actionId).toBeTruthy();

    await pollActionStatus(request, uid, actionId, idToken, "complete");

    const capturedResponse = await request.get(`${apiBaseURL}/e2e/mock-llm/requests?uid=${encodeURIComponent(uid)}`);
    expect(capturedResponse.status()).toBe(200);
    const captures = await capturedResponse.json();
    expect(captures).toHaveLength(1);
    const providerBoundary = captures[0];
    expect(providerBoundary.system).toContain(candidatePreferences);
    expect(providerBoundary.system).toContain("You extract structured CV data");
    expect(providerBoundary.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: minimalPDF.toString("base64") },
          },
          { type: "text", text: "Parse this PDF CV into the provided JSON schema." },
        ],
      },
    ]);
    expect(providerBoundary.schema).toMatchObject({ title: "CVAI CV Format" });

    const serializedBoundary = JSON.stringify(providerBoundary);
    for (const excluded of ["credit_balance", "has_ever_purchased", "ada@example.test", "actions", "billing", "stories", "events"]) {
      expect(serializedBoundary).not.toContain(excluded);
    }

    const candidateDoc = await getFirestoreDoc(request, uid, "candidate/profile", idToken);
    expect(candidateDoc.status()).toBe(200);
    const candidate = await candidateDoc.json();
    const contact = candidate.fields.cv.mapValue.fields.contact.mapValue.fields;
    expect(contact.name.stringValue).toBe("Ada");
    expect(contact.surname.stringValue).toBe("Lovelace");

    const accountResponse = await request.get(`${apiBaseURL}/account`, { headers: { Authorization: `Bearer ${idToken}` } });
    expect(accountResponse.status()).toBe(200);
    const account = await accountResponse.json();
    expect(account.CreditBalance).toBe(0);
  });

  test("a user with no scripted mock response gets a failed action and a refunded credit", async ({ request }) => {
    const { idToken, uid } = await signUp(request, `cv-import-nofixture-${Date.now()}@example.test`);
    await seedCredit(request, uid, idToken, 1);

    const upload = await request.post(`${apiBaseURL}/cv/imports`, {
      headers: { Authorization: `Bearer ${idToken}` },
      multipart: { pdf: { name: "cv.pdf", mimeType: "application/pdf", buffer: minimalPDF } },
    });
    expect(upload.status()).toBe(202);
    const { actionId } = await upload.json();

    await pollActionStatus(request, uid, actionId, idToken, "failed");

    const accountResponse = await request.get(`${apiBaseURL}/account`, { headers: { Authorization: `Bearer ${idToken}` } });
    expect(accountResponse.status()).toBe(200);
    const account = await accountResponse.json();
    expect(account.CreditBalance).toBe(1);
  });

  test("a request with no credits is rejected before any import is queued", async ({ request }) => {
    const { idToken } = await signUp(request, `cv-import-nocredit-${Date.now()}@example.test`);

    const upload = await request.post(`${apiBaseURL}/cv/imports`, {
      headers: { Authorization: `Bearer ${idToken}` },
      multipart: { pdf: { name: "cv.pdf", mimeType: "application/pdf", buffer: minimalPDF } },
    });
    expect(upload.status()).toBe(402);
  });
});
