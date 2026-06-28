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
    await openAccountPanel(page);
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

  test("is available from an existing CV and warns before replacement", async ({ page }) => {
    await signIn(page, "cv.import.replace@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, importedCandidate());

    await expect(page.getByRole("button", { name: /Import from PDF/ })).toBeVisible();
    await page.getByRole("button", { name: /Import from PDF/ }).click();
    await expect(page.getByText("Importing a PDF will replace the current CV.")).toBeVisible();
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
    await page.reload();
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
    await expect(page.getByText("Reference ID")).toBeVisible();
    await expect(page.getByText("import-failed")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
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

  test("validation notice uses user-recognisable fields", async ({ page }) => {
    await signIn(page, "cv.validation@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, incompleteValidationCandidate());

    const notice = page.getByRole("alert");
    await expect(notice.getByRole("heading", { name: "These fields are missing" })).toBeVisible();
    await expect(notice.getByText("Summary")).toBeVisible();
    await expect(notice.getByText("location for Senior Operations Manager at Paragon Global Brands")).toBeVisible();
    await expect(notice.getByText("tasks and outcomes for Senior Operations Manager at Paragon Global Brands")).toBeVisible();
    await expect(page.getByText("cv.experience[0]")).toHaveCount(0);
    await expect(page.getByText("item(s)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Print" })).toBeDisabled();
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

    await waitForCVSave(page);
    await page.reload();
    await expect(page.getByLabel("First name")).toHaveValue("Ada");
    expect(apiCalls).toEqual([]);
  });
});

test.describe("UC-CV-003 imported CV editor", () => {
  test("sparse imported CV remains editable", async ({ page }) => {
    await signIn(page, "cv.sparse@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, sparseImportedCandidate());

    await expect(page.getByLabel("First name")).toHaveValue("Sparse");
    await page.getByLabel("Surname").fill("Candidate");
    await page.getByLabel("Email").fill("sparse@example.test");
    await saveVisibleSection(page);

    await openCVSection(page, "Languages");
    await addEntryPanel(page);
    await expect(page.locator(".entry-panel").first()).toContainText("New languages entry");
    await page.getByRole("textbox", { name: "Language" }).fill("Esperanto");
    await page.getByLabel("Level").fill("Conversational");
    await saveVisibleSection(page);

    await page.reload();
    await expect(page.getByLabel("Surname")).toHaveValue("Candidate");
    await openCVSection(page, "Languages");
    await editEntryPanel(page, "Esperanto");
    await expect(page.getByRole("textbox", { name: "Language" })).toHaveValue("Esperanto");
    await expect(page.getByLabel("Level")).toHaveValue("Conversational");
  });

  test("large imported CV exposes and preserves many entries", async ({ page }) => {
    await signIn(page, "cv.large@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, largeAcademicCandidate());

    await expect(page.getByLabel("First name")).toHaveValue("Proteus");
    await openCVSection(page, "Experience");
    await expect(page.locator(".entry-panel")).toHaveCount(28);
    await editEntryPanel(page, "Institute 28");
    await expect(page.getByRole("textbox", { name: "Company" })).toHaveValue("Institute 28");
    const openEditor = page.locator(".entry-panel-editor");
    await expect(openEditor.getByRole("region", { name: /Visiting professor 28\.3/ })).toBeVisible();
    await expect(openEditor.getByRole("region", { name: /Visiting professor 28\.1/ })).toBeVisible();
    await expectTextBefore(openEditor, "Visiting professor 28.3", "Visiting professor 28.1");
    await expect(openEditor.getByLabel("Roles, one per line").first()).toHaveValue("Visiting professor 28.3");
    await expect(openEditor.getByLabel("Start").first()).toHaveValue("2007-01-01");
    await expect(openEditor.getByLabel("Current position").first()).toBeChecked();
    await openEditor.getByLabel("Tasks and outcomes, one per line").first().fill("Published paper 28.3\nDelivered lecture 28.3\nWon impossible grant");
    await saveVisibleSection(page);

    await openCVSection(page, "Languages");
    await expect(page.locator(".entry-panel")).toHaveCount(14);
    await editEntryPanel(page, "Language 14");
    await expect(page.getByRole("textbox", { name: "Language" })).toHaveValue("Language 14");
    await expect(page.getByLabel("Level")).toHaveValue("Research fluency");

    await page.reload();
    await openCVSection(page, "Experience");
    await expect(page.locator(".entry-panel")).toHaveCount(28);
    await editEntryPanel(page, "Institute 28");
    await expect(page.getByLabel("Tasks and outcomes, one per line").first()).toHaveValue(
      "Published paper 28.3\nDelivered lecture 28.3\nWon impossible grant",
    );
  });

  test("multi-entry sections can edit imported entries beyond the first", async ({ page }) => {
    await signIn(page, "cv.multi@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, multiEntryCandidate());

    await openCVSection(page, "Experience");
    await expectTextBefore(page.locator(".entry-panel-list"), "Second Company", "First Company");
    await editEntryPanel(page, "Second Company");
    await expect(page.getByRole("textbox", { name: "Company" })).toHaveValue("Second Company");
    await page.getByRole("textbox", { name: "Company" }).fill("Second Company Edited");
    await saveVisibleSection(page);

    await openCVSection(page, "Education");
    await expectTextBefore(page.locator(".entry-panel-list"), "PhD Systems", "MSc Computing");
    await editEntryPanel(page, "PhD Systems");
    await expect(page.getByLabel("Qualification")).toHaveValue("PhD Systems");
    await page.getByLabel("Qualification").fill("PhD Systems Edited");
    await saveVisibleSection(page);

    await openCVSection(page, "Certifications");
    await expectTextBefore(page.locator(".entry-panel-list"), "Second Cert", "First Cert");
    await editEntryPanel(page, "Second Cert");
    await expect(page.getByRole("textbox", { name: "Certification" })).toHaveValue("Second Cert");
    await page.getByRole("textbox", { name: "Certification" }).fill("Second Cert Edited");
    await saveVisibleSection(page);

    await openCVSection(page, "Languages");
    await editEntryPanel(page, "French");
    await expect(page.getByRole("textbox", { name: "Language" })).toHaveValue("French");
    await page.getByLabel("Level").fill("Professional");
    await saveVisibleSection(page);

    await openCVSection(page, "Languages");
    await dragListItem(page, "Move language entry 2", "Move language entry 1");
    await expectTextBefore(page.locator(".entry-panel-list"), "French", "English");
    await waitForCVSave(page);

    await page.reload();
    await openCVSection(page, "Experience");
    await editEntryPanel(page, "Second Company Edited");
    await expect(page.getByRole("textbox", { name: "Company" })).toHaveValue("Second Company Edited");
    await openCVSection(page, "Education");
    await editEntryPanel(page, "PhD Systems Edited");
    await expect(page.getByLabel("Qualification")).toHaveValue("PhD Systems Edited");
    await openCVSection(page, "Certifications");
    await editEntryPanel(page, "Second Cert Edited");
    await expect(page.getByRole("textbox", { name: "Certification" })).toHaveValue("Second Cert Edited");
    await openCVSection(page, "Languages");
    await expectTextBefore(page.locator(".entry-panel-list"), "French", "English");
    await editEntryPanel(page, "French");
    await expect(page.getByLabel("Level")).toHaveValue("Professional");
  });

  test("new position defaults current position to unchecked with End visible", async ({ page }) => {
    await signIn(page, "cv.experience.defaults@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await openCVSection(page, "Experience");
    await addEntryPanel(page);
    await expect(page.getByLabel("Current position")).not.toBeChecked();
    await expect(page.getByLabel("End")).toBeVisible();
  });

  test("checking current position hides End field and unchecking restores it", async ({ page }) => {
    await signIn(page, "cv.experience.current-toggle@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await openCVSection(page, "Experience");
    await addEntryPanel(page);
    await expect(page.getByLabel("End")).toBeVisible();
    await expect(page.getByLabel("End")).toBeEnabled();
    await page.getByLabel("Current position").check();
    await expect(page.getByLabel("End")).toBeHidden();
    await expect(page.getByLabel("End")).toBeDisabled();
    await page.getByLabel("Current position").uncheck();
    await expect(page.getByLabel("End")).toBeVisible();
    await expect(page.getByLabel("End")).toBeEnabled();
  });

  test("experience entry subtitle shows year-only period", async ({ page }) => {
    await signIn(page, "cv.experience.subtitle-years@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, currentAndEndedExperienceCandidate());

    await openCVSection(page, "Experience");
    await expect(regionByName(page, "Ended Recent Company")).toContainText("2024 – 2025");
    await expect(regionByName(page, "Current Older Company")).toContainText("Since 2020");
    await expect(regionByName(page, "Current Newer Company")).toContainText("Since 2022");
  });

  test("experience lists current roles first, then by most recent start", async ({ page }) => {
    await signIn(page, "cv.current-order@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, currentAndEndedExperienceCandidate());

    await openCVSection(page, "Experience");
    const list = page.locator(".entry-panel-list");
    await expectTextBefore(list, "Current Newer Company", "Current Older Company");
    await expectTextBefore(list, "Current Older Company", "Ended Recent Company");
  });

  test("manual saves recompute CV validation errors", async ({ page }) => {
    await signIn(page, "cv.revalidate@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, multiEntryCandidate());

    await expect(page.getByRole("button", { name: "Print" })).toBeEnabled();

    await openCVSection(page, "Summary");
    await page.getByRole("textbox", { name: "Summary" }).fill("");
    await saveVisibleSection(page);

    const notice = page.getByRole("alert");
    await expect(notice.getByText("Summary")).toBeVisible();
    await expect(page.getByRole("button", { name: "Print" })).toBeDisabled();

    await page.getByRole("textbox", { name: "Summary" }).fill("Multi-entry imported CV.");
    await saveVisibleSection(page);

    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Print" })).toBeEnabled();
  });

  test("entry panels support cancel and confirmed removal", async ({ page }) => {
    await signIn(page, "cv.panels@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, multiEntryCandidate());

    await openCVSection(page, "Languages");
    await editEntryPanel(page, "English");
    await page.getByLabel("Level").fill("Experimental");
    await page.getByRole("button", { name: "Cancel" }).click();
    await editEntryPanel(page, "English");
    await expect(page.getByLabel("Level")).toHaveValue("Native");
    await page.getByRole("button", { name: "Cancel" }).click();

    const frenchPanel = regionByName(page, "French");
    await frenchPanel.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByRole("dialog", { name: "Remove languages entry?" })).toBeVisible();
    await page.getByRole("dialog", { name: "Remove languages entry?" }).getByRole("button", { name: "Cancel" }).click();
    await expect(regionByName(page, "French")).toBeVisible();

    await frenchPanel.getByRole("button", { name: "Remove" }).click();
    await page.getByRole("dialog", { name: "Remove languages entry?" }).getByRole("button", { name: "Remove" }).click();
    await expect(regionByName(page, "French")).toHaveCount(0);
    await waitForCVSave(page);
  });
});

test.describe("UC-CV-003 completeness advances", () => {
  test("progress advances after filling experience", async ({ page }) => {
    await signIn(page, "cv.progress@example.test");
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.getByRole("button", { name: "Experience", exact: true }).click();
    await addEntryPanel(page);
    await page.getByRole("textbox", { name: "Company" }).fill("Analytical Engines Ltd");
    await page.getByLabel("Roles, one per line").fill("Principal engineer");
    await page.getByLabel("Tasks and outcomes, one per line").fill("Shipped reliable systems");
    await saveVisibleSection(page);
    await openAccountPanel(page);
    await expect(page.getByRole("progressbar", { name: "CV completeness" })).not.toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
});

test.describe("candidate preferences", () => {
  test("preferences save on blur and persist after reload", async ({ page }) => {
    await signIn(page, "cv.preferences@example.test");
    await page.getByRole("link", { name: "Preferences", exact: true }).click();
    const preferences =
      "Remote-first roles, transparent salary bands, and sectors with strong public-interest value.";

    await page.getByRole("textbox", { name: "Preferences and constraints" }).fill(preferences);
    await expect(page.getByText(`${preferences.length}/2000`)).toBeVisible();
    await page.getByRole("textbox", { name: "Preferences and constraints" }).fill("x".repeat(1801));
    await expect(page.getByText("1801/2000")).toHaveClass(/preference-count-warning/);
    await page.getByRole("textbox", { name: "Preferences and constraints" }).fill("Remote-first roles ");
    await expect(page.getByRole("textbox", { name: "Preferences and constraints" })).toHaveValue("Remote-first roles ");
    await page.getByRole("textbox", { name: "Preferences and constraints" }).fill(preferences);
    await page.getByRole("textbox", { name: "Preferences and constraints" }).blur();
    await expect(page.locator(".field[data-save-status='saved']")).toBeVisible();

    await page.reload();
    await expect(page.getByRole("textbox", { name: "Preferences and constraints" })).toHaveValue(preferences);
  });
});

test.describe("UC-CV-004 CV print/PDF export", () => {
  test("print button opens preview dialog and triggers iframe print", async ({ page }) => {
    await page.addInitScript(() => {
      window.print = () => {
        const target = window as typeof window & { __printCalls?: number };
        target.__printCalls = (target.__printCalls ?? 0) + 1;
      };
    });

    await signIn(page, "cv.print@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, importedCandidate());
    await page.reload();

    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await page.getByRole("button", { name: "Print" }).click();
    await expect(page).toHaveURL(/\/profile\/cv$/);
    const dialog = page.getByRole("dialog", { name: "CV print preview" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Print template")).toHaveValue("default");
    await expect(page.frameLocator("iframe[title='CV print preview']").getByLabel("Printable CV default")).toContainText("Ada Lovelace");
    await dialog.getByRole("button", { name: "Print" }).click();
    await expect
      .poll(() =>
        page
          .frameLocator("iframe[title='CV print preview']")
          .locator("body")
          .evaluate(() => (window as typeof window & { __printCalls?: number }).__printCalls ?? 0),
      )
      .toBe(1);
  });

  test("default print preview contains core CV sections", async ({ page }) => {
    await signIn(page, "cv.print.layout@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, importedCandidate());
    await page.reload();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await page.getByRole("button", { name: "Print" }).click();

    const printLayout = page.frameLocator("iframe[title='CV print preview']").getByLabel("Printable CV default");
    await expect(printLayout).toBeVisible();
    await expect(printLayout).toContainText("Ada Lovelace");
    await expect(printLayout).toContainText("ada@example.test");
    await expect(printLayout).toContainText("Analytical engineer.");
    await expect(printLayout.getByRole("heading", { name: "Experience" })).toBeVisible();
    await expect(printLayout).toContainText("Engines Ltd");
    await expect(printLayout.getByRole("heading", { name: "Education" })).toBeVisible();
    await expect(printLayout).toContainText("Mathematics");
    await expect(printLayout.getByRole("heading", { name: "Skills" })).toBeVisible();
    await expect(printLayout).toContainText("Go");
  });

  test("ATS template can be selected inside the preview dialog", async ({ page }) => {
    await signIn(page, "cv.print.ats@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, importedCandidate());
    await page.reload();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();

    await page.getByRole("button", { name: "Print" }).click();
    const dialog = page.getByRole("dialog", { name: "CV print preview" });
    await dialog.getByLabel("Print template").selectOption("ats");
    const printLayout = page.frameLocator("iframe[title='CV print preview']").getByLabel("Printable CV ATS");
    await expect(printLayout).toContainText("Ada Lovelace");
    await expect(printLayout.getByRole("heading", { name: "Summary" })).toBeVisible();
  });

  test("print templates list work experience newest first", async ({ page }) => {
    await signIn(page, "cv.print.order@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, currentAndEndedExperienceCandidate());
    await page.reload();

    await page.getByRole("button", { name: "Print" }).click();
    const frame = page.frameLocator("iframe[title='CV print preview']");
    const defaultLayout = frame.getByLabel("Printable CV default");
    await expect(defaultLayout).toBeVisible();
    await expectTextBefore(defaultLayout, "Current Newer Company", "Current Older Company");
    await expectTextBefore(defaultLayout, "Current Older Company", "Ended Recent Company");

    const dialog = page.getByRole("dialog", { name: "CV print preview" });
    await dialog.getByLabel("Print template").selectOption("ats");
    const atsLayout = frame.getByLabel("Printable CV ATS");
    await expect(atsLayout).toBeVisible();
    await expectTextBefore(atsLayout, "Current Newer Company", "Current Older Company");
    await expectTextBefore(atsLayout, "Current Older Company", "Ended Recent Company");
  });

  test("ATS preview uses the same A4 page frame as the default template", async ({ page }) => {
    await signIn(page, "cv.print.ats.frame@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, importedCandidate());
    await page.reload();

    await page.getByRole("button", { name: "Print" }).click();
    const dialog = page.getByRole("dialog", { name: "CV print preview" });
    await dialog.getByLabel("Print template").selectOption("ats");

    const frame = page.frameLocator("iframe[title='CV print preview']");
    const pageFrame = frame.locator(".cv-print-page");
    await expect(frame.getByLabel("Printable CV ATS")).toBeVisible();

    const frameStyles = await pageFrame.evaluate((element) => {
      const bodyStyle = getComputedStyle(document.body);
      const pageStyle = getComputedStyle(element);
      return {
        bodyBackground: bodyStyle.backgroundColor,
        boxShadow: pageStyle.boxShadow,
        paddingLeft: parseFloat(pageStyle.paddingLeft),
        width: parseFloat(pageStyle.width),
      };
    });

    expect(frameStyles.bodyBackground).toBe("rgb(232, 237, 242)");
    expect(frameStyles.boxShadow).not.toBe("none");
    expect(frameStyles.paddingLeft).toBeGreaterThan(60);
    expect(frameStyles.width).toBeGreaterThan(750);
    expect(frameStyles.width).toBeLessThan(850);
  });

  test("app and modal chrome are absent from the iframe print document", async ({ page }) => {
    await signIn(page, "cv.print.chrome@example.test");
    const session = await currentSession(page);
    await writeCandidate(session, importedCandidate());
    await page.reload();
    await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
    await page.getByRole("button", { name: "Print" }).click();

    const frame = page.frameLocator("iframe[title='CV print preview']");
    const printLayout = frame.getByLabel("Printable CV default");
    await expect(printLayout).toBeVisible();
    await expect(printLayout.locator(".sidebar")).toHaveCount(0);
    await expect(printLayout.locator(".top-nav")).toHaveCount(0);
    await expect(printLayout.getByRole("button")).toHaveCount(0);
    await expect(frame.getByText("Close")).toHaveCount(0);
    await expect(frame.getByText("Template")).toHaveCount(0);
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
    await page.getByRole("button", { name: "Add link" }).click();
    await expect(page.getByPlaceholder("LinkedIn, My portfolio, GitHub")).toBeVisible();
    await expect(page.getByPlaceholder("https://linkedin.com/in/my-user")).toBeVisible();
    await page.getByLabel("Link 1 label").fill("LinkedIn");
    await page.getByLabel("Link 1 URL").fill("https://linkedin.example/ada");
    await page.getByRole("button", { name: "Add link" }).click();
    await page.getByLabel("Link 1 label").fill("GitHub");
    await page.getByLabel("Link 1 URL").fill("https://github.example/ada");
    await page.getByRole("button", { name: "Add link" }).click();
    await page.getByLabel("Link 1 label").fill("Website");
    await page.getByLabel("Link 1 URL").fill("https://ada.example");
    await dragListItem(page, "Move link entry 3", "Move link entry 1");
    await saveVisibleSection(page);

    await openCVSection(page, "Summary");
    await page
      .getByRole("textbox", { name: "Summary" })
      .fill("Analytical engineer focused on reliable systems.");
    await page
      .getByRole("textbox", { name: "Summary" })
      .fill("Analytical engineer focused on reliable systems. ");
    await expect(page.getByRole("textbox", { name: "Summary" })).toHaveValue(
      "Analytical engineer focused on reliable systems. ",
    );
    await page
      .getByRole("textbox", { name: "Summary" })
      .fill("Analytical engineer focused on reliable systems.");
    await saveVisibleSection(page);

    await openCVSection(page, "Experience");
    await addEntryPanel(page);
    await page.getByRole("textbox", { name: "Company" }).fill("Analytical Engines Ltd");
    await page.getByLabel("Roles, one per line").fill("Principal engineer ");
    await expect(page.getByLabel("Roles, one per line")).toHaveValue("Principal engineer ");
    await page.getByLabel("Roles, one per line").fill("Principal engineer\nSystems lead");
    await page.getByLabel("Start").fill("2021-01-01");
    await page.getByLabel("Current position").check();
    await page.getByLabel("Location").fill("London");
    await page
      .getByLabel("Tasks and outcomes, one per line")
      .fill("Designed deterministic workflows ");
    await expect(page.getByLabel("Tasks and outcomes, one per line")).toHaveValue("Designed deterministic workflows ");
    await page
      .getByLabel("Tasks and outcomes, one per line")
      .fill("Designed deterministic workflows\nReduced incident rate");
    await saveVisibleSection(page);

    await openCVSection(page, "Education");
    await addEntryPanel(page);
    await page.getByLabel("Qualification").fill("BSc Mathematics");
    await page.getByLabel("Type").fill("Degree");
    await page.getByLabel("Issuer").fill("University of London");
    await page.getByLabel("Year").fill("2020");
    await saveVisibleSection(page);

    await openCVSection(page, "Skills");
    await page.getByLabel("Skill 1").fill("TypeScript");
    await page.getByRole("button", { name: "Add skill" }).click();
    await page.getByLabel("Skill 1").fill("Go");
    await page.getByRole("button", { name: "Add skill" }).click();
    await page.getByLabel("Skill 1").fill("Distributed systems");
    await dragListItem(page, "Move skill entry 3", "Move skill entry 1");
    await saveVisibleSection(page);

    await openCVSection(page, "Certifications");
    await addEntryPanel(page);
    await page.getByRole("textbox", { name: "Certification" }).fill("Cloud Architect");
    await page.getByLabel("Credential ID").fill("CERT-123");
    await page.getByLabel("Issuer").fill("Cloud Guild");
    await page.getByLabel("Year").fill("2023");
    await saveVisibleSection(page);

    await openCVSection(page, "Languages");
    await addEntryPanel(page);
    await page.getByRole("textbox", { name: "Language" }).fill("English");
    await page.getByLabel("Level").fill("Native");
    await saveVisibleSection(page);

    await openAccountPanel(page);
    await expect(page.getByRole("progressbar", { name: "CV completeness" })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    await page.getByRole("button", { name: "Close" }).click();

    await page.reload();
    await expect(page.getByLabel("First name")).toHaveValue("Ada");
    await expect(page.getByLabel("Surname")).toHaveValue("Lovelace");
    await expect(page.getByLabel("Email")).toHaveValue("ada@example.test");
    await expect(page.getByLabel("Phone prefix")).toHaveValue("+44");
    await expect(page.getByLabel("Phone number")).toHaveValue("02070000000");
    await expect(page.getByLabel("Link 1 label")).toHaveValue("LinkedIn");
    await expect(page.getByLabel("Link 1 URL")).toHaveValue("https://linkedin.example/ada");
    await expect(page.getByLabel("Link 2 label")).toHaveValue("Website");
    await expect(page.getByLabel("Link 2 URL")).toHaveValue("https://ada.example");
    await expect(page.getByLabel("Link 3 label")).toHaveValue("GitHub");
    await expect(page.getByLabel("Link 3 URL")).toHaveValue("https://github.example/ada");

    await openCVSection(page, "Summary");
    await expect(page.getByRole("textbox", { name: "Summary" })).toHaveValue(
      "Analytical engineer focused on reliable systems.",
    );

    await openCVSection(page, "Experience");
    await editEntryPanel(page, "Analytical Engines Ltd");
    await expect(page.getByRole("textbox", { name: "Company" })).toHaveValue("Analytical Engines Ltd");
    await expect(page.getByLabel("Roles, one per line")).toHaveValue(
      "Principal engineer\nSystems lead",
    );
    await expect(page.getByLabel("Start")).toHaveValue("2021-01-01");
    await expect(page.getByLabel("Current position")).toBeChecked();
    await expect(page.getByLabel("End")).toBeHidden();
    await expect(page.getByLabel("End")).toBeDisabled();
    await expect(page.getByLabel("Location")).toHaveValue("London");
    await expect(page.getByLabel("Tasks and outcomes, one per line")).toHaveValue(
      "Designed deterministic workflows\nReduced incident rate",
    );

    await openCVSection(page, "Education");
    await editEntryPanel(page, "BSc Mathematics");
    await expect(page.getByLabel("Qualification")).toHaveValue("BSc Mathematics");
    await expect(page.getByLabel("Type")).toHaveValue("Degree");
    await expect(page.getByLabel("Issuer")).toHaveValue("University of London");
    await expect(page.getByLabel("Year")).toHaveValue("2020");

    await openCVSection(page, "Skills");
    await expect(page.getByLabel("Skill 1")).toHaveValue("TypeScript");
    await expect(page.getByLabel("Skill 2")).toHaveValue("Distributed systems");
    await expect(page.getByLabel("Skill 3")).toHaveValue("Go");

    await openCVSection(page, "Certifications");
    await editEntryPanel(page, "Cloud Architect");
    await expect(page.getByRole("textbox", { name: "Certification" })).toHaveValue("Cloud Architect");
    await expect(page.getByLabel("Credential ID")).toHaveValue("CERT-123");
    await expect(page.getByLabel("Issuer")).toHaveValue("Cloud Guild");
    await expect(page.getByLabel("Year")).toHaveValue("2023");

    await openCVSection(page, "Languages");
    await editEntryPanel(page, "English");
    await expect(page.getByRole("textbox", { name: "Language" })).toHaveValue("English");
    await expect(page.getByLabel("Level")).toHaveValue("Native");
    expect(apiCalls.filter((url) => !url.endsWith("/api/account"))).toEqual([]);
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

async function addEntryPanel(page: Page) {
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

async function editEntryPanel(page: Page, name: string) {
  await regionByName(page, name).getByRole("button", { name: "Edit" }).click();
}

async function dragListItem(page: Page, sourceLabel: string, targetLabel: string) {
  await page.getByLabel(sourceLabel).dragTo(page.getByLabel(targetLabel));
}

function regionByName(page: Page, name: string) {
  return page.getByRole("region", { name: new RegExp(escapeRegExp(name)) });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function expectTextBefore(locator: ReturnType<Page["locator"]>, earlier: string, later: string) {
  await expect
    .poll(async () => {
      const text = (await locator.textContent()) ?? "";
      return text.indexOf(earlier) >= 0 && text.indexOf(later) >= 0 && text.indexOf(earlier) < text.indexOf(later);
    })
    .toBe(true);
}

async function saveVisibleSection(page: Page) {
  const sectionSave = page.getByRole("button", { name: "Save section" });
  if ((await sectionSave.count()) > 0) {
    await sectionSave.click();
  } else {
    await page.getByRole("button", { name: "Save", exact: true }).click();
  }
  await waitForCVSave(page);
}

async function waitForCVSave(page: Page) {
  await expect(page.locator(".cv-section[data-save-status='saved']")).toBeVisible();
}

async function openAccountPanel(page: Page) {
  await page.getByRole("button", { name: "Open account panel" }).click();
  await expect(page.getByRole("dialog", { name: "Account panel" })).toBeVisible();
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
    },
    context: { version: 1, constraints: {}, preferences: {} },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function sparseImportedCandidate() {
  return {
    cv: {
      summary: "",
      contact: {
        name: "Sparse",
        surname: "",
        phone: { prefix: "", number: "" },
        email: "",
        links: [],
      },
      skills: [],
      languages: [],
      certifications: [],
      education: [],
      experience: [],
      projects: { items: [] },
    },
    context: { version: 1, constraints: {}, preferences: {} },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function incompleteValidationCandidate() {
  return {
    cv: {
      summary: "",
      contact: {
        name: "Pat",
        surname: "Example",
        phone: { prefix: "+44", number: "123456" },
        email: "pat@example.test",
        links: [],
      },
      skills: ["Operations"],
      languages: [{ name: "English", level: "Native" }],
      certifications: [],
      education: [],
      experience: [
        {
          company: "Paragon Global Brands",
          positions: [
            {
              id: "senior-ops",
              roles: ["Senior Operations Manager"],
              start: "2020",
              location: "",
              tasks: [],
            },
          ],
        },
      ],
      projects: { items: [] },
    },
    cv_validation_errors: [
      "cv.summary is required",
      "cv.experience[0]: experience.positions[0]: cv_position.location is required",
      "cv.experience[0]: experience.positions[0]: cv_position.tasks must contain at least 1 item(s)",
    ],
    context: { version: 1, constraints: {}, preferences: {} },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function multiEntryCandidate() {
  return {
    cv: {
      summary: "Multi-entry imported CV.",
      contact: {
        name: "Multi",
        surname: "Entry",
        phone: { prefix: "+1", number: "5550100" },
        email: "multi@example.test",
        links: [{ label: "LinkedIn", url: "https://linkedin.example/multi" }],
      },
      skills: ["Go", "TypeScript"],
      languages: [
        { name: "English", level: "Native" },
        { name: "French", level: "Working" },
      ],
      certifications: [
        { name: "First Cert", id: "FIRST", issuer: "Guild", year: 2020 },
        { name: "Second Cert", id: "SECOND", issuer: "Guild", year: 2021 },
      ],
      education: [
        { name: "MSc Computing", type: "Degree", issuer: "First University", year: 2015 },
        { name: "PhD Systems", type: "Doctorate", issuer: "Second University", year: 2019 },
      ],
      experience: [
        {
          company: "First Company",
          positions: [{ id: "first-position", roles: ["Engineer"], start: "2019", location: "Remote", tasks: ["Built first thing"] }],
        },
        {
          company: "Second Company",
          positions: [{ id: "second-position", roles: ["Lead"], start: "2021", location: "Berlin", tasks: ["Built second thing"] }],
        },
      ],
      projects: { items: [] },
    },
    context: { version: 1, constraints: {}, preferences: {} },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function currentAndEndedExperienceCandidate() {
  return {
    cv: {
      summary: "Current and ended roles.",
      contact: {
        name: "Current",
        surname: "Order",
        phone: { prefix: "+1", number: "5550199" },
        email: "current-order@example.test",
        links: [],
      },
      skills: ["Planning"],
      languages: [{ name: "English", level: "Native" }],
      certifications: [],
      education: [],
      experience: [
        {
          company: "Ended Recent Company",
          positions: [
            {
              id: "ended-recent",
              roles: ["Principal Consultant"],
              start: "2024-01-01",
              end: "2025-01-01",
              location: "Remote",
              tasks: ["Delivered recent programme"],
            },
          ],
        },
        {
          company: "Current Older Company",
          positions: [
            {
              id: "current-older",
              roles: ["Operations Lead"],
              start: "2020-01-01",
              location: "London",
              tasks: ["Runs current operations"],
            },
          ],
        },
        {
          company: "Current Newer Company",
          positions: [
            {
              id: "current-newer",
              roles: ["Portfolio Director"],
              start: "2022-01-01",
              location: "Berlin",
              tasks: ["Leads current portfolio"],
            },
          ],
        },
      ],
      projects: { items: [] },
    },
    context: { version: 1, constraints: {}, preferences: {} },
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function largeAcademicCandidate() {
  return {
    cv: {
      summary:
        "Famously unstable and prolific professor with appointments, publications, public lectures, and languages everywhere.",
      contact: {
        name: "Proteus",
        surname: "Polyglot",
        phone: { prefix: "+41", number: "5552800" },
        email: "proteus@example.test",
        links: [
          { label: "LinkedIn", url: "https://linkedin.example/proteus" },
          { label: "GitHub", url: "https://github.example/proteus" },
          { label: "Website", url: "https://proteus.example" },
        ],
      },
      skills: Array.from({ length: 36 }, (_, index) => `Research skill ${index + 1}`),
      languages: Array.from({ length: 14 }, (_, index) => ({
        name: `Language ${index + 1}`,
        level: index === 13 ? "Research fluency" : "Professional",
      })),
      certifications: Array.from({ length: 12 }, (_, index) => ({
        name: `Academic honour ${index + 1}`,
        id: `HONOUR-${index + 1}`,
        issuer: `Society ${index + 1}`,
        year: 1990 + index,
      })),
      education: Array.from({ length: 8 }, (_, index) => ({
        name: `Degree ${index + 1}`,
        type: index === 7 ? "Doctorate" : "Degree",
        issuer: `University ${index + 1}`,
        year: 1975 + index,
      })),
      experience: Array.from({ length: 28 }, (_, experienceIndex) => ({
        company: `Institute ${experienceIndex + 1}`,
        positions: Array.from({ length: 3 }, (_, positionIndex) => ({
          id: `institute-${experienceIndex + 1}-position-${positionIndex + 1}`,
          roles: [`Visiting professor ${experienceIndex + 1}.${positionIndex + 1}`],
          start: String(1980 + experienceIndex),
          end: positionIndex === 2 ? "Present" : String(1981 + experienceIndex),
          location: `Campus ${experienceIndex + 1}`,
          tasks: [
            `Published paper ${experienceIndex + 1}.${positionIndex + 1}`,
            `Delivered lecture ${experienceIndex + 1}.${positionIndex + 1}`,
          ],
        })),
      })),
      projects: {
        url: "https://proteus.example/publications",
        items: Array.from({ length: 20 }, (_, index) => ({
          name: `Publication project ${index + 1}`,
          summary: `Research programme ${index + 1}`,
          url: `https://proteus.example/publications/${index + 1}`,
          description: `Long-running research and publication stream ${index + 1}.`,
        })),
      },
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
