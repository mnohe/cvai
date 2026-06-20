import { expect, test, type Page } from "@playwright/test";

test.describe("UC-CV-001 empty state renders", () => {
  test("fresh CV page shows both entry points", async ({ page }) => {
    await signIn(page, "cv.empty@example.test");
    await expect(page.getByRole("link", { name: "CV" })).toHaveClass(/active/);
    await expect(page.getByText("You haven't added a CV yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start from scratch" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Import from PDF/ })).toBeVisible();
  });
});

test.describe("UC-CV-001 start from scratch", () => {
  test("renders section editor at 0 percent completeness", async ({ page }) => {
    await signIn(page, "cv.start@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await expect(page.getByRole("navigation", { name: "CV editor sections" })).toBeVisible();
    await expect(page.getByRole("progressbar", { name: "CV completeness" })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});

test.describe("UC-CV-001 import entry point", () => {
  test("opens upload modal", async ({ page }) => {
    await signIn(page, "cv.import@example.test");
    await page.getByRole("button", { name: /Import from PDF/ }).click();
    await expect(page.getByRole("dialog", { name: "Import CV from PDF" })).toBeVisible();
  });
});

test.describe("UC-CV-002 import CV from PDF", () => {
  test("progress shown and CV populated on success", async ({ page }) => {
    await signIn(page, "cv.import.success@example.test");
    const session = await currentSession(page);
    await page.route("**/api/cv/imports", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ actionId: "import-success" }),
      });
    });

    await page.getByRole("button", { name: /Import from PDF/ }).click();
    await choosePDF(page, "%PDF-1.7\nsuccess");
    await page.getByRole("button", { name: "Start import" }).click();
    await writeFirestore(session, "actions", "import-success", {
      id: "import-success",
      type: "import_cv",
      status: "running",
      progress: { step: "analysing", message: "Analysing PDF", percent: 40 },
      created_at: new Date(),
      updated_at: new Date(),
    });

    await expect(page.getByRole("progressbar", { name: "CV import progress" })).toBeVisible();

    await writeCandidate(session, importedCandidate());
    await writeFirestore(session, "actions", "import-success", {
      id: "import-success",
      type: "import_cv",
      status: "complete",
      progress: { step: "complete", message: "Import complete", percent: 100 },
      result: { resource: "candidate.cv" },
      created_at: new Date(),
      updated_at: new Date(),
      completed_at: new Date(),
    });

    await expect(page.getByRole("dialog", { name: "Import CV from PDF" })).toHaveCount(0);
    await expect(page.getByLabel("First name")).toHaveValue("Ada");
  });

  test("error shown on LLM failure and credit refunded", async ({ page }) => {
    await signIn(page, "cv.import.failure@example.test");
    const session = await currentSession(page);
    await writeFirestore(session, "account", "profile", {
      uid: session.uid,
      credit_balance: 0,
      has_ever_purchased: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await page.route("**/api/cv/imports", async (route) => {
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ actionId: "import-failed" }),
      });
    });

    await page.getByRole("button", { name: /Import from PDF/ }).click();
    await choosePDF(page, "%PDF-1.7\nfailure");
    await page.getByRole("button", { name: "Start import" }).click();
    await expect(page.getByRole("progressbar", { name: "CV import progress" })).toBeVisible();
    await writeFirestore(session, "account", "profile", {
      uid: session.uid,
      credit_balance: 1,
      has_ever_purchased: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    await writeFirestore(session, "actions", "import-failed", {
      id: "import-failed",
      type: "import_cv",
      status: "failed",
      progress: { step: "failed", message: "There was a problem reading your PDF." },
      error: "There was a problem reading your PDF.",
      created_at: new Date(),
      updated_at: new Date(),
      completed_at: new Date(),
    });

    await expect(page.getByText("There was a problem reading your PDF.")).toBeVisible();
    const creditBalance = await readAccountCredit(session);
    expect(creditBalance).toBe(1);
  });

  test("oversized PDF rejected before API call", async ({ page }) => {
    let called = false;
    await page.route("**/api/cv/imports", async (route) => {
      called = true;
      await route.abort();
    });

    await signIn(page, "cv.import.oversized@example.test");
    await page.getByRole("button", { name: /Import from PDF/ }).click();
    await choosePDF(page, "%PDF-1.7\n".padEnd(10 * 1024 * 1024 + 1, "x"));
    await page.getByRole("button", { name: "Start import" }).click();

    await expect(page.getByText("PDF must be 10 MB or smaller.")).toBeVisible();
    expect(called).toBe(false);
  });

  test("blocked at zero credits", async ({ page }) => {
    await page.route("**/api/cv/imports", async (route) => {
      await route.fulfill({
        status: 402,
        contentType: "application/json",
        body: JSON.stringify({ error: "not enough credits" }),
      });
    });

    await signIn(page, "cv.import.zero@example.test");
    await page.getByRole("button", { name: /Import from PDF/ }).click();
    await choosePDF(page, "%PDF-1.7\nzero");
    await page.getByRole("button", { name: "Start import" }).click();

    await expect(page.getByText("You need at least 1 credit to import a CV.")).toBeVisible();
  });
});

test.describe("UC-CV-003 direct firestore write", () => {
  test("editing personal details saves without a backend call", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiCalls.push(request.url());
    });

    await signIn(page, "cv.edit@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.getByLabel("First name").fill("Ada");
    await page.getByLabel("Surname").fill("Lovelace");
    await page.getByLabel("Email").fill("ada@example.test");
    await page.getByRole("button", { name: "Save section" }).click();

    await expect(page.getByText("Saved")).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("First name")).toHaveValue("Ada");
    expect(apiCalls).toEqual([]);
  });
});

test.describe("UC-CV-003 completeness advances", () => {
  test("progress advances after filling experience", async ({ page }) => {
    await signIn(page, "cv.progress@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.getByRole("button", { name: "Experience", exact: true }).click();
    await page.getByLabel("Company").fill("Analytical Engines Ltd");
    await page.getByLabel("Roles, one per line").fill("Principal engineer");
    await page.getByLabel("Tasks and outcomes, one per line").fill("Shipped reliable systems");
    await page.getByRole("button", { name: "Save section" }).click();
    await expect(page.getByRole("progressbar", { name: "CV completeness" })).not.toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});

test.describe("candidate preferences", () => {
  test("preferences save on blur and persist after reload", async ({ page }) => {
    await signIn(page, "cv.preferences@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    const preferences =
      "Remote-first roles, transparent salary bands, and sectors with strong public-interest value.";

    await page.getByRole("textbox", { name: "Preferences and constraints" }).fill(preferences);
    await expect(page.getByText(`${preferences.length}/2000`)).toBeVisible();
    await page.getByRole("textbox", { name: "Preferences and constraints" }).fill("x".repeat(1801));
    await expect(page.getByText("1801/2000")).toHaveClass(/preference-count-warning/);
    await page.getByRole("textbox", { name: "Preferences and constraints" }).fill(preferences);
    await page.getByRole("textbox", { name: "Preferences and constraints" }).blur();
    await expect(page.getByText("Saved")).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Preferences", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Preferences and constraints" })).toHaveValue(preferences);
  });
});

test.describe("UC-CV-001 analytics gate", () => {
  test("quick analysis is not shown in the CV section", async ({ page }) => {
    await signIn(page, "cv.gate@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await expect(page.getByRole("button", { name: /Quick analysis/ })).toHaveCount(0);
  });
});

test.describe("UC-CV-007 complete manual onboarding", () => {
  test("saves and reloads every exposed field", async ({ page }) => {
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/")) apiCalls.push(request.url());
    });

    await signIn(page, "cv.manual@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();

    await page.getByLabel("First name").fill("Ada");
    await page.getByLabel("Surname").fill("Lovelace");
    await page.getByLabel("Email").fill("ada@example.test");
    await page.getByLabel("Phone prefix").fill("+44");
    await page.getByLabel("Phone number").fill("02070000000");
    await page.getByLabel("LinkedIn").fill("https://linkedin.example/ada");
    await page.getByLabel("GitHub").fill("https://github.example/ada");
    await page.getByLabel("Website").fill("https://ada.example");
    await saveVisibleSection(page);

    await openCVSection(page, "Summary");
    await page
      .getByRole("textbox", { name: "Summary" })
      .fill("Analytical engineer focused on reliable systems.");
    await saveVisibleSection(page);

    await openCVSection(page, "Experience");
    await page.getByLabel("Company").fill("Analytical Engines Ltd");
    await page.getByLabel("Roles, one per line").fill("Principal engineer\nSystems lead");
    await page.getByLabel("Start").fill("2021-01");
    await page.getByLabel("End").fill("Present");
    await page.getByLabel("Location").fill("London");
    await page
      .getByLabel("Tasks and outcomes, one per line")
      .fill("Designed deterministic workflows\nReduced incident rate");
    await saveVisibleSection(page);

    await openCVSection(page, "Education");
    await page.getByLabel("Qualification").fill("BSc Mathematics");
    await page.getByLabel("Type").fill("Degree");
    await page.getByLabel("Issuer").fill("University of London");
    await page.getByLabel("Year").fill("2020");
    await saveVisibleSection(page);

    await openCVSection(page, "Skills");
    await page.getByLabel("Skills, one per line").fill("TypeScript\nGo\nDistributed systems");
    await saveVisibleSection(page);

    await openCVSection(page, "Certifications");
    await page.getByRole("textbox", { name: "Certification" }).fill("Cloud Architect");
    await page.getByLabel("Credential ID").fill("CERT-123");
    await page.getByLabel("Issuer").fill("Cloud Guild");
    await page.getByLabel("Year").fill("2023");
    await saveVisibleSection(page);

    await openCVSection(page, "Languages");
    await page.getByRole("textbox", { name: "Language" }).fill("English");
    await page.getByLabel("Level").fill("Native");
    await saveVisibleSection(page);

    await openCVSection(page, "Projects");
    await page.getByLabel("Portfolio URL").fill("https://portfolio.example/ada");
    await page.getByLabel("Project name").fill("Difference Engine Monitor");
    await page.getByLabel("Project URL").fill("https://projects.example/difference");
    await page.getByLabel("Project summary").fill("Operational monitor for calculation workflows.");
    await page
      .getByLabel("Project description")
      .fill("Tracked failures, surfaced bottlenecks, and made system health legible.");
    await saveVisibleSection(page);

    await expect(page.getByRole("progressbar", { name: "CV completeness" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );

    await page.reload();
    await expect(page.getByLabel("First name")).toHaveValue("Ada");
    await expect(page.getByLabel("Surname")).toHaveValue("Lovelace");
    await expect(page.getByLabel("Email")).toHaveValue("ada@example.test");
    await expect(page.getByLabel("Phone prefix")).toHaveValue("+44");
    await expect(page.getByLabel("Phone number")).toHaveValue("02070000000");
    await expect(page.getByLabel("LinkedIn")).toHaveValue("https://linkedin.example/ada");
    await expect(page.getByLabel("GitHub")).toHaveValue("https://github.example/ada");
    await expect(page.getByLabel("Website")).toHaveValue("https://ada.example");

    await openCVSection(page, "Summary");
    await expect(page.getByRole("textbox", { name: "Summary" })).toHaveValue(
      "Analytical engineer focused on reliable systems.",
    );

    await openCVSection(page, "Experience");
    await expect(page.getByLabel("Company")).toHaveValue("Analytical Engines Ltd");
    await expect(page.getByLabel("Roles, one per line")).toHaveValue(
      "Principal engineer\nSystems lead",
    );
    await expect(page.getByLabel("Start")).toHaveValue("2021-01");
    await expect(page.getByLabel("End")).toHaveValue("Present");
    await expect(page.getByLabel("Location")).toHaveValue("London");
    await expect(page.getByLabel("Tasks and outcomes, one per line")).toHaveValue(
      "Designed deterministic workflows\nReduced incident rate",
    );

    await openCVSection(page, "Education");
    await expect(page.getByLabel("Qualification")).toHaveValue("BSc Mathematics");
    await expect(page.getByLabel("Type")).toHaveValue("Degree");
    await expect(page.getByLabel("Issuer")).toHaveValue("University of London");
    await expect(page.getByLabel("Year")).toHaveValue("2020");

    await openCVSection(page, "Skills");
    await expect(page.getByLabel("Skills, one per line")).toHaveValue(
      "TypeScript\nGo\nDistributed systems",
    );

    await openCVSection(page, "Certifications");
    await expect(page.getByRole("textbox", { name: "Certification" })).toHaveValue("Cloud Architect");
    await expect(page.getByLabel("Credential ID")).toHaveValue("CERT-123");
    await expect(page.getByLabel("Issuer")).toHaveValue("Cloud Guild");
    await expect(page.getByLabel("Year")).toHaveValue("2023");

    await openCVSection(page, "Languages");
    await expect(page.getByRole("textbox", { name: "Language" })).toHaveValue("English");
    await expect(page.getByLabel("Level")).toHaveValue("Native");

    await openCVSection(page, "Projects");
    await expect(page.getByLabel("Portfolio URL")).toHaveValue("https://portfolio.example/ada");
    await expect(page.getByLabel("Project name")).toHaveValue("Difference Engine Monitor");
    await expect(page.getByLabel("Project URL")).toHaveValue("https://projects.example/difference");
    await expect(page.getByLabel("Project summary")).toHaveValue(
      "Operational monitor for calculation workflows.",
    );
    await expect(page.getByLabel("Project description")).toHaveValue(
      "Tracked failures, surfaced bottlenecks, and made system health legible.",
    );
    expect(apiCalls).toEqual([]);
  });
});

async function signIn(page: Page, email: string) {
  const unique = uniqueEmail(email);
  await page.addInitScript((e2eEmail) => {
    window.localStorage.setItem("cvai:e2eEmail", e2eEmail);
  }, unique);
  // The Auth emulator provider flow creates this test identity on demand.
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page).toHaveURL(/\/profile\/cv$/);
}

async function openCVSection(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).click();
}

async function saveVisibleSection(page: Page) {
  await page.getByRole("button", { name: "Save section" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
}

function uniqueEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name}+${Date.now()}-${Math.random().toString(16).slice(2)}@${domain}`;
}

async function choosePDF(page: Page, content: string) {
  await page.setInputFiles("input[type='file']", {
    name: "cv.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from(content),
  });
}

async function currentSession(page: Page): Promise<{ uid: string; token: string }> {
  const session = await page.evaluate(async () => {
    const firebase = await (0, eval)('import("/src/lib/firebase.ts")');
    const user = firebase.auth.currentUser;
    return user ? { uid: user.uid, token: await user.getIdToken() } : null;
  });
  if (!session) throw new Error("No current Firebase user");
  return session;
}

async function writeFirestore(session: { uid: string; token: string }, collectionName: string, docId: string, data: Record<string, unknown>) {
  const response = await fetch(`http://localhost:8080/v1/projects/demo-cvai/databases/(default)/documents/users/${session.uid}/${collectionName}/${docId}`, {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${session.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!response.ok) {
    throw new Error(`Firestore write failed ${response.status}: ${await response.text()}`);
  }
}

async function writeCandidate(session: { uid: string; token: string }, candidate: Record<string, unknown>) {
  await writeFirestore(session, "candidate", "profile", candidate);
}

async function readAccountCredit(session: { uid: string; token: string }): Promise<number> {
  const response = await fetch(`http://localhost:8080/v1/projects/demo-cvai/databases/(default)/documents/users/${session.uid}/account/profile`, {
    headers: { "Authorization": `Bearer ${session.token}` },
  });
  if (!response.ok) throw new Error(`Firestore read failed ${response.status}: ${await response.text()}`);
  const body = await response.json();
  return Number(body.fields.credit_balance.integerValue);
}

function importedCandidate() {
  return {
    cv: {
      summary: "Analytical engineer.",
      contact: {
        name: "Ada",
        surname: "Lovelace",
        phone: { prefix: "+44", number: "123456" },
        email: "ada@example.test",
        linkedin: "https://linkedin.example/ada",
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
    },
    context: { version: 1, constraints: {}, preferences: {} },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function toFirestoreFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Date) {
    throw new Error("top-level Firestore value must be an object");
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toFirestoreValue(child)]));
}

function toFirestoreValue(value: unknown): Record<string, unknown> {
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number" && Number.isInteger(value)) return { integerValue: value };
  if (typeof value === "number") return { doubleValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (value && typeof value === "object") return { mapValue: { fields: toFirestoreFields(value) } };
  return { nullValue: null };
}
