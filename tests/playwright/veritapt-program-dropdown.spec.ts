// tests/playwright/veritapt-program-dropdown.spec.ts
//
// Gate 3 step 8 browser evidence for the VeritaPT enrollment Program Name
// dropdown (server/ptVendorCatalog.ts + GET /api/veritapt/programs + the
// VeritaPTAppPage Add Enrollment modal). Program Name was a free-text box;
// it is now a dropdown of the selected vendor's programs, and picking one
// auto-fills PT Category and lists the tests the program includes.
//
// Drives the real modal: open Add Enrollment, pick a vendor whose catalog is
// loaded, assert the Program Name control is a Select (not a text box) and that
// choosing a program populates the PT Category + renders the included tests.
//
// Env: PW_BASE, PW_TOKEN (a user with VeritaPT access on a lab), PW_PT_LAB
// (lab id), PW_PT_VENDOR (a vendor whose catalog is loaded, e.g. "API").
// Skips without them so the compile-only smoke gate stays green (repo pattern).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_PT_LAB || "";
const VENDOR = process.env.PW_PT_VENDOR || "API";

test.describe("VeritaPT — Program Name is a vendor program dropdown", () => {
  test("selecting a vendor program auto-fills PT Category and lists the tests", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_PT_LAB (and a vendor catalog loaded via /api/admin/veritapt/vendor-programs).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapt/app`, { waitUntil: "domcontentloaded" });

    // Open the Add Enrollment modal.
    await page.getByRole("button", { name: /add enrollment/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/PT Program Enrollments|Add Enrollment/i).first()).toBeVisible();

    // Pick the vendor whose catalog is loaded.
    await dialog.getByText("Vendor", { exact: false }).locator("..").getByRole("combobox").click().catch(() => {});
    await page.getByRole("option", { name: VENDOR, exact: true }).click().catch(() => {});

    // Program Name must now be a SELECT (placeholder "Select a <vendor> program"),
    // not the legacy free-text input.
    const programTrigger = dialog.getByText(new RegExp(`Select a ${VENDOR} program`, "i"));
    await expect(programTrigger).toBeVisible({ timeout: 8000 });

    // Choose the first program option and confirm the category auto-fills and
    // the included tests render.
    await programTrigger.click();
    const firstOption = page.getByRole("option").first();
    const programName = (await firstOption.textContent())?.trim() || "";
    await firstOption.click();

    await expect(dialog.getByText(/from program/i)).toBeVisible();
    await expect(dialog.getByText(/Tests included/i)).toBeVisible();
    expect(programName.length).toBeGreaterThan(0);
  });
});
