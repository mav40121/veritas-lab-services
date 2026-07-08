// tests/playwright/coverage-attribution-dialog.spec.ts
//
// Gate 3 step 8 for the Phase 2 allocation challenge (CoverageAttributionDialog).
// After saving a coverage-relevant study whose name matches no map analyte and
// that isn't auto-attributed, the create form must pop the "Which map point does
// this study cover?" dialog with a map-analyte Select + a "Not on our map yet"
// escape.
//
// Two modes:
//   - Default (CI / no PW_ATTR_DRIVE): compile + a non-mutating check that the
//     create form renders. CI's prod run must NOT create studies, so the
//     save-triggered path is gated behind PW_ATTR_DRIVE and skipped here.
//   - PW_ATTR_DRIVE=1 (run by hand against a lab WITH a map, e.g. San Carlos):
//     fill a non-matching test name + custom TEa, save, assert the dialog, and
//     dismiss via "Not on our map yet" (non-mutating: no alignment written).
//
// Env: PW_BASE, PW_TOKEN (a lab user), PW_LAB_ID (a lab that has a VeritaMap).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const DRIVE = process.env.PW_ATTR_DRIVE === "1";

test.describe("Coverage attribution challenge", () => {
  test("save of an unmatched study prompts to attribute it", async ({ page }) => {
    if (!TOKEN || !LAB_ID) {
      test.skip(true, "No PW_TOKEN / PW_LAB_ID (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`);
    // Non-mutating: the create form renders its test-name field.
    await expect(page.getByRole("heading", { name: /New Study|Verification|VeritaCheck/i }).first()).toBeVisible({ timeout: 20000 });

    if (!DRIVE) {
      test.skip(true, "Set PW_ATTR_DRIVE=1 to exercise the save-triggered dialog (mutates prod).");
      return;
    }

    // Drive the save-triggered dialog (run by hand, not in CI).
    const name = "ZZQ ATTR PROBE";
    await page.getByLabel(/test name/i).first().fill(name).catch(async () => {
      await page.locator('input[name="testName"], input#testName').first().fill(name);
    });
    // Choose a custom TEa so the study won't auto-attribute, then save.
    await page.getByText(/Use custom TEa/i).first().click().catch(() => {});
    await page.getByRole("button", { name: /^Save|Save Study|Save Verification/i }).first().click();

    const dialog = page.locator('[data-testid="coverage-attribution-dialog"]');
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Which map point does this study cover/i)).toBeVisible();
    await expect(page.locator('[data-testid="attribution-analyte-select"]')).toBeVisible();
    // Dismiss without aligning (non-mutating).
    await page.locator('[data-testid="attribution-not-on-map"]').click();
    await expect(dialog).not.toBeVisible();
  });
});
