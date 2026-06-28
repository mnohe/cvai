import { expect, test, type Page } from "@playwright/test";
import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from "firebase/auth";
import { connectFirestoreEmulator, doc, getFirestore, setDoc } from "firebase/firestore";

let app: FirebaseApp | undefined;

test.describe("UC-ONBOARD-001", () => {
  test("meter shows red at 0/5 on fresh account", async ({ page }) => {
    await signIn(page, "onboard.red@example.test");
    await expect(page.getByRole("button", { name: "Profile completion 0 of 5" })).toBeVisible();
  });

  test("meter turns amber after personal details saved", async ({ page }) => {
    await signIn(page, "onboard.amber@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.getByLabel("First name").fill("Katherine");
    await page.getByLabel("Email").fill("katherine@example.test");
    await page.getByRole("button", { name: "Save section" }).click();
    await expect(page.getByRole("button", { name: "Profile completion 1 of 5" })).toBeVisible();
  });

  test("meter turns green after work experience added", async ({ page }) => {
    await signIn(page, "onboard.green@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.getByLabel("First name").fill("Mary");
    await page.getByLabel("Email").fill("mary@example.test");
    await page.getByRole("button", { name: "Save section" }).click();
    await page.getByRole("button", { name: "Experience", exact: true }).click();
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("textbox", { name: "Company" }).fill("Orbital Mechanics Inc");
    await page.getByLabel("Roles, one per line").fill("Analyst");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Profile completion 2 of 5" })).toBeVisible();
  });

  test("meter hidden after all 5 segments satisfied", async ({ page }) => {
    const email = "onboard.hidden@example.test";
    const uid = await signIn(page, email);
    await seedCompleteCandidate(uid);
    await page.goto("/profile/cv");
    await expect(page.getByRole("button", { name: /Profile completion/ })).toHaveCount(0);
  });

  test("clicking meter opens the CV completion panel", async ({ page }) => {
    await signIn(page, "onboard.click@example.test");
    await page.getByRole("button", { name: "Profile completion 0 of 5" }).click();
    await expect(page).toHaveURL(/\/profile\/cv$/);
    await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
  });

  test("dismissed profile completion collapses into title diamonds", async ({ page }) => {
    await signIn(page, "onboard.diamonds@example.test");
    await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();

    await page.getByRole("button", { name: "Dismiss completion panel" }).click();
    await expect(page.getByRole("heading", { name: "Complete your profile" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Show profile completion details, 0 of 5 complete" })).toBeVisible();

    await page.getByRole("link", { name: "Show profile completion details, 0 of 5 complete" }).click();
    await expect(page.getByRole("heading", { name: "Complete your profile" })).toBeVisible();
  });
});

async function signIn(page: Page, email: string): Promise<string> {
  const unique = uniqueEmail(email);
  await page.addInitScript((e2eEmail) => {
    window.localStorage.setItem("cvai:e2eEmail", e2eEmail);
  }, unique);
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with Google" }).click();
  await expect(page).toHaveURL(/\/profile\/cv$/);

  const auth = getAuth(getTestApp());
  connectAuthEmulatorOnce(auth);
  const credential = await signInWithEmailAndPassword(
    auth,
    unique,
    "CorrectHorseBatteryStaple123!",
  );
  return credential.user.uid;
}

function uniqueEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name}+${Date.now()}-${Math.random().toString(16).slice(2)}@${domain}`;
}

async function seedCompleteCandidate(uid: string) {
  const firestore = getFirestore(getTestApp());
  connectFirestoreEmulatorOnce(firestore);
  await setDoc(doc(firestore, "users", uid, "candidate", "profile"), {
    cv: {
      contact: {
        name: "Complete",
        surname: "User",
        email: "complete@example.test",
        links: [],
        phone: { prefix: "", number: "" },
      },
      summary: "Complete profile",
      skills: ["TypeScript"],
      languages: [],
      certifications: [],
      education: [{ name: "BSc", issuer: "University", year: 2020 }],
      experience: [
        {
          company: "CVAI",
          positions: [{ id: "pos-1", roles: ["Engineer"], start: "2021", location: "", tasks: [] }],
        },
      ],
      projects: { items: [] },
    },
    context: { version: 1, constraints: {}, preferences: {} },
    story_bank: [{ id: "story-1", title: "Shipped something useful" }],
    evidence_library: [{ id: "evidence-1", keyword: "impact", evidence_pointer: "portfolio" }],
    created_at: new Date(),
    updated_at: new Date(),
  });
}

function getTestApp() {
  if (!app) {
    app = initializeApp(
      {
        apiKey: "demo-api-key",
        authDomain: "demo-cvai.firebaseapp.com",
        projectId: "demo-cvai",
        storageBucket: "demo-cvai.appspot.com",
        messagingSenderId: "000000000000",
        appId: "1:000000000000:web:0000000000000000000000",
      },
      "cvai-e2e-tests",
    );
  }
  return app;
}

function connectAuthEmulatorOnce(auth: ReturnType<typeof getAuth>) {
  if (!("_cvaiEmulatorConnected" in auth)) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    Object.assign(auth, { _cvaiEmulatorConnected: true });
  }
}

function connectFirestoreEmulatorOnce(firestore: ReturnType<typeof getFirestore>) {
  if (!("_cvaiEmulatorConnected" in firestore)) {
    connectFirestoreEmulator(firestore, "127.0.0.1", 8080);
    Object.assign(firestore, { _cvaiEmulatorConnected: true });
  }
}
