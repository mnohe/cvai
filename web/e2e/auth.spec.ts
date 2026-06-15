import { expect, test, type Page } from "@playwright/test";

test.describe("UC-AUTH-001", () => {
  test("unauthenticated navigation redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("redirect to cv after signup", async ({ page }) => {
    await signIn(page, "Google", "signup.user@example.test");
    await expect(page).toHaveURL(/\/profile\/cv$/);
    await expect(page.getByRole("heading", { name: "CV" })).toBeVisible();
  });
});

test.describe("UC-AUTH-002", () => {
  test("signin redirects to dashboard", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("cvai:e2eReturning", "true");
      window.localStorage.setItem("cvai:e2eEmail", "returning.user@example.test");
    });
    await signIn(page, "Google", "returning.user@example.test");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  });

  test("signin redirects to cv when no profile", async ({ page }) => {
    await signIn(page, "GitHub", "no.profile@example.test");
    await expect(page).toHaveURL(/\/profile\/cv$/);
  });

  test("shell renders sidebar with identity after sign-in", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "Google", "shell.user@example.test");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByText("New User")).toBeVisible();
    await expect(page.getByText("shell.user@example.test")).toBeVisible();
  });
});

test.describe("UC-AUTH-003", () => {
  test("account panel opens and shows name/email", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "Google", "panel.user@example.test");
    await page.getByRole("button", { name: "Open account panel" }).click();
    const panel = page.getByRole("dialog", { name: "Account panel" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "New User" })).toBeVisible();
    await expect(panel.getByText("panel.user@example.test")).toBeVisible();
    await expect(panel.getByText("Google")).toBeVisible();
  });

  test("signout redirects to login", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "Google", "signout.user@example.test");
    await page.getByRole("button", { name: "Open account panel" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("protected routes inaccessible after signout", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "Google", "postsignout.user@example.test");
    await page.getByRole("button", { name: "Open account panel" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});

async function signIn(
  page: Page,
  provider: "Google" | "GitHub",
  email = "new.user@example.test",
) {
  await page.addInitScript((e2eEmail) => {
    window.localStorage.setItem("cvai:e2eEmail", e2eEmail);
  }, email);
  await page.goto("/login");
  await page.getByRole("button", { name: `Sign in with ${provider}` }).click();
}
