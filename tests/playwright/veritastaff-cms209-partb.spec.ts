// tests/playwright/veritastaff-cms209-partb.spec.ts
//
// Gate 3 step 8 for CMS-209 Part B (B-2 UI). Exercises the two new
// user-clickable surfaces in VeritaStaff without mutating the real lab:
//   1. Lab Setup dialog renders the "Specialties this lab performs" grid.
//   2. Add Employee dialog: selecting TC/TS shows the "Specific specialties
//      vs Entire lab" scope toggle, and choosing "Entire lab" swaps the
//      specialty grid for the expansion preview / empty-list warning.
//
// Non-destructive: opens dialogs and clicks in-memory toggles only; never
// clicks Save, so no prod data changes. Persistence is covered server-side
// by scripts/verify-cms209-partb.mts.
//
// Env:
//   PW_BASE   — base URL (default prod)
//   PW_TOKEN  — owner JWT for PW_LAB_ID
//   PW_LAB_ID — default 3 (Michaels Lab)

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStaff CMS-209 Part B UI", () => {
  test("lab specialty list + TC/TS entire-lab scope toggle render and react", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required for authed VeritaStaff page load");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastaff-app`, { waitUntil: "domcontentloaded" });

    // ---- Lab Setup: the director-set specialty list ----
    const labSetupBtn = page.getByRole("button", { name: /lab setup/i }).first();
    if (!(await labSetupBtn.isVisible().catch(() => false))) {
      test.skip(true, "Lab Setup button not visible (lab may lack VeritaStaff plan)");
      return;
    }
    await labSetupBtn.click();
    const labSpecialties = page.getByTestId("lab-specialties");
    await expect(labSpecialties).toBeVisible({ timeout: 8000 });
    // The grid offers the CMS specialties as toggle chips (Chemistry = 7).
    await expect(labSpecialties.getByRole("button", { name: /7\. Chemistry/i })).toBeVisible();
    // Close without saving (no prod mutation).
    await page.keyboard.press("Escape");

    // ---- Add Employee: TC/TS entire-lab scope toggle ----
    const addBtn = page.getByRole("button", { name: /add employee/i }).first();
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Pick whichever high/moderate role this lab exposes.
    const tsRole = page.getByRole("button", { name: /^TS$/ });
    const tcRole = page.getByRole("button", { name: /^TC$/ });
    const useTs = await tsRole.isVisible().catch(() => false);
    const prefix = useTs ? "ts" : "tc";
    await (useTs ? tsRole : tcRole).click();

    const scopeToggle = page.getByTestId(`${prefix}-scope-toggle`);
    await expect(scopeToggle).toBeVisible({ timeout: 8000 });

    // Switch to "Entire lab": the specialty grid is replaced by the preview
    // (or the empty-list warning). Either way one of these must appear.
    await page.getByTestId(`${prefix}-entire-lab`).click();
    const preview = page.getByText(/expands to one row per specialty/i);
    const emptyWarn = page.getByTestId("entire-lab-empty");
    await expect(preview.or(emptyWarn)).toBeVisible({ timeout: 8000 });
  });
});
