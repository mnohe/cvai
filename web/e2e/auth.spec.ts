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
    await expect(page.getByText("New User")).toBeVisible();
    await expect(page.getByText("shell.user@example.test")).toBeVisible();
  });
});

test.describe("UC-AUTH-003", () => {
  test("account panel opens and shows name/email", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await signIn(page, "Google", "panel.user@example.test");
    await page.getByText("panel.user@example.test").click();
    const panel = page.getByRole("dialog", { name: "Account panel" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "New User" })).toBeVisible();
    await expect(panel.getByText("panel.user@example.test")).toBeVisible();
    await expect(panel.getByText("Google")).toBeVisible();
  });

  test("account panel shows credits and links to billing settings", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await routeAccount(page, { creditBalance: 12 });

    await signIn(page, "Google", "panel.credits@example.test");
    await page.getByRole("button", { name: "Open account panel" }).click();

    const panel = page.getByRole("dialog", { name: "Account panel" });
    await expect(panel.getByText("12 credits remaining")).toBeVisible();
    await panel.getByRole("link", { name: /12 credits remaining/ }).click();

    await expect(page).toHaveURL(/\/settings#billing$/);
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("12 credits")).toBeVisible();
  });

  test("account panel hides credits when hosted billing is unavailable", async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await routeAccount(page, { hosted: false });

    await signIn(page, "Google", "panel.no-credits@example.test");
    await page.getByRole("button", { name: "Open account panel" }).click();

    const panel = page.getByRole("dialog", { name: "Account panel" });
    await expect(panel.getByRole("link", { name: /credits remaining/ })).toHaveCount(0);
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

test.describe("Billing", () => {
  test("settings show hosted credits and start checkout for selected pack", async ({ page }) => {
    let checkoutBody: unknown;
    await routeAccount(page, { creditBalance: 12 });
    await page.route("**/api/billing/checkout", async (route) => {
      checkoutBody = route.request().postDataJSON();
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          url: `${new URL(route.request().url()).origin}/settings?checkout=started`,
          sessionId: "cs_test_created",
        }),
      });
    });

    await signIn(page, "Google", "billing.user@example.test");
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();
    await expect(page.getByText("12 credits")).toBeVisible();
    await expect(page.getByLabel("Credit pack")).toHaveValue("pack_starter");
    await expect(page.getByText("Purchase history")).toHaveCount(0);
    await expect(page.getByText("Stripe")).toHaveCount(0);

    await page.getByLabel("Credit pack").selectOption("pack_active");
    await page.getByRole("button", { name: "Buy" }).click();
    await expect(page).toHaveURL(/checkout=started/);
    const pendingSession = await page.evaluate(() => window.sessionStorage.getItem("cvai:pendingCheckoutSessionId"));
    expect(pendingSession).toBe("cs_test_created");
    expect(checkoutBody).toMatchObject({
      packId: "pack_active",
      cancelUrl: expect.stringContaining("/settings?checkout=cancelled"),
      successUrl: expect.stringContaining("/settings?checkout=success&session_id={CHECKOUT_SESSION_ID}"),
    });
  });

  test("settings show checkout start errors", async ({ page }) => {
    await routeAccount(page, { creditBalance: 12 });
    await page.route("**/api/billing/checkout", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        status: 400,
        body: JSON.stringify({ error: "failed to create checkout session" }),
      });
    });

    await signIn(page, "Google", "billing.checkout-error@example.test");
    await page.goto("/settings");
    await page.getByRole("button", { name: "Buy" }).click();

    await expect(page.getByText("Checkout could not be started.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buy" })).toBeEnabled();
  });

  test("settings confirm successful checkout and refresh credits", async ({ page }) => {
    let balance = 12;
    let confirmBody: unknown;
    await routeAccount(page, { creditBalance: () => balance });
    await page.route("**/api/billing/checkout/confirm", async (route) => {
      confirmBody = route.request().postDataJSON();
      balance = 32;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ processed: true }),
      });
    });

    await signIn(page, "Google", "billing.confirm@example.test");
    await page.goto("/settings?checkout=success&session_id=cs_test_confirm");

    await expect(page.getByText("32 credits")).toBeVisible();
    await expect(page.getByText("Stripe is confirming the purchase. Credits will appear shortly.")).toHaveCount(0);
    expect(confirmBody).toMatchObject({ sessionId: "cs_test_confirm" });
  });

  test("settings confirm checkout from stored pending session when return URL has no session id", async ({ page }) => {
    let balance = 12;
    let confirmBody: unknown;
    await routeAccount(page, { creditBalance: () => balance });
    await page.route("**/api/billing/checkout/confirm", async (route) => {
      confirmBody = route.request().postDataJSON();
      balance = 72;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ processed: true }),
      });
    });

    await signIn(page, "Google", "billing.stored-session@example.test");
    await page.evaluate(() => window.sessionStorage.setItem("cvai:pendingCheckoutSessionId", "cs_test_stored"));
    await page.goto("/settings?checkout=success");

    await expect(page.getByText("72 credits")).toBeVisible();
    expect(confirmBody).toMatchObject({ sessionId: "cs_test_stored" });
    const pendingSession = await page.evaluate(() => window.sessionStorage.getItem("cvai:pendingCheckoutSessionId"));
    expect(pendingSession).toBeNull();
  });

  test("settings show confirmation failures after Stripe return", async ({ page }) => {
    await routeAccount(page, { creditBalance: 12 });
    await page.route("**/api/billing/checkout/confirm", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        status: 400,
        body: JSON.stringify({ error: "failed to retrieve checkout session" }),
      });
    });

    await signIn(page, "Google", "billing.confirm-error@example.test");
    await page.goto("/settings?checkout=success&session_id=cs_test_failed");

    await expect(page.getByText("Stripe is confirming the purchase. Credits will appear shortly.")).toBeVisible();
    await expect(page.getByText("Checkout completed, but credits could not be confirmed yet.")).toBeVisible();
    await expect(page.getByText("12 credits")).toBeVisible();
  });

  test("settings show cancelled checkout state", async ({ page }) => {
    await routeAccount(page, { creditBalance: 12 });

    await signIn(page, "Google", "billing.cancel@example.test");
    await page.goto("/settings?checkout=cancelled");

    await expect(page.getByText("Checkout was cancelled.")).toBeVisible();
    await expect(page.getByText("12 credits")).toBeVisible();
  });

  test("settings show billing unavailable for non-hosted account payloads", async ({ page }) => {
    await routeAccount(page, { hosted: false });

    await signIn(page, "Google", "billing.unavailable@example.test");
    await page.goto("/settings");

    await expect(page.getByText("Credit billing is not enabled for this deployment.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buy" })).toHaveCount(0);
  });
});

async function routeAccount(
  page: Page,
  options: { hosted?: boolean; creditBalance?: number | (() => number) } = {},
) {
  const hosted = options.hosted ?? true;
  await page.route("**/api/account", async (route) => {
    const creditBalance =
      typeof options.creditBalance === "function"
        ? options.creditBalance()
        : (options.creditBalance ?? 12);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        uid: "billing-user",
        email: "billing.user@example.test",
        ...(hosted
          ? {
              creditBalance,
              hasEverPurchased: true,
              purchaseHistory: [
                {
                  id: "purchase-1",
                  provider: "stripe",
                  creditAmount: 20,
                  purchasedAt: "2026-06-24T12:00:00Z",
                },
              ],
            }
          : {}),
      }),
    });
  });
}

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
  await expect(page).toHaveURL(/\/(profile\/cv|dashboard)$/);
}
