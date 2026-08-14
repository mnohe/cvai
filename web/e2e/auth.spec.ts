import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await mockHealthyApi(page);
});

test.describe("UC-AUTH-001", () => {
  test("unauthenticated navigation redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  });

  test("redirect to cv after signup", async ({ page }) => {
    await signIn(page, "Google", "signup.user@example.test");
    await expect(page).toHaveURL(/\/profile\/cv$/);
    await expect(page.getByRole("link", { name: "CV" })).toHaveClass(/active/);
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
    const sidebar = page.locator("aside.sidebar");
    await expect(sidebar.getByText("New User")).toBeVisible();
    await expect(sidebar.getByText("shell.user@example.test")).toHaveCount(0);
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
    await expect(panel.getByText("Google")).toHaveCount(0);
    await expect(panel.getByText("Credits")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  });

  test("signout redirects to login", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "Google", "signout.user@example.test");
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("signout stays grouped and compact across responsive account layouts", async ({ page }) => {
    const longEmail = "a.very.long.email.address.for.layout.testing@really-long-example-domain.test";
    await page.setViewportSize({ width: 360, height: 740 });
    await signIn(page, "Google", longEmail);
    await page.evaluate(() => {
      window.localStorage.setItem("cvai:e2eProvider", "Google,GitHub,Microsoft");
    });
    await page.goto("/settings");

    const account = page.locator("section.settings-section").filter({
      has: page.getByRole("heading", { name: "Account" }),
    });
    const identityRow = account.locator(".account-identity-row");
    const signOutButton = identityRow.getByRole("button", { name: "Sign out" });
    await expect(identityRow).toContainText(longEmail);
    await expect(signOutButton).toBeVisible();
    await expect(identityRow.locator(".provider-pill")).toHaveCount(3);
    await signOutButton.focus();
    await expect(signOutButton).toBeFocused();

    const buttonBox = await signOutButton.boundingBox();
    const emailBox = await identityRow.getByText(longEmail).boundingBox();
    const accountBox = await account.boundingBox();
    expect(buttonBox).not.toBeNull();
    expect(emailBox).not.toBeNull();
    expect(accountBox).not.toBeNull();
    expect(buttonBox!.width).toBeLessThan(216);
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(360);
    expect(accountBox!.x + accountBox!.width - (buttonBox!.x + buttonBox!.width)).toBeLessThan(24);
    expect(emailBox!.x + emailBox!.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  });

  test("signout failure remains on settings and exposes a retryable error", async ({ page }) => {
    await signIn(page, "Google", "signout.failure@example.test");
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.evaluate(() => {
      Storage.prototype.removeItem = () => {
        throw new Error("simulated persistence failure");
      };
    });

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole("alert")).toHaveText(
      "Unable to sign out. Please try again.",
    );
    await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  test("protected routes inaccessible after signout", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "Google", "postsignout.user@example.test");
    await page.getByRole("button", { name: "Open settings" }).click();
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

async function mockHealthyApi(page: Page) {
  await page.route("**/api/healthz", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "ok" }),
    });
  });
}
