// tests/playwright/study-exclusion-verdict.spec.ts
//
// Gate 3 step 8 receipt for VeritaCheck Phase 2 (exclusion-aware verdict +
// FAIL -> PASS justification gate). Drives the real browser flow:
//   - Open a FAILing study -> Manage data points -> Exclude the outlier.
//   - The exclusion flips the verdict FAIL -> PASS, so the server returns 422
//     and the dialog shows the verdict-justification step.
//   - Record the justification -> the exclusion lands and the verdict updates.
//   - Restore the point (cleanup) so the spec is idempotent.
//
// Env:
//   PW_BASE          default https://www.veritaslabservices.com
//   PW_TOKEN         bearer for a writer in the lab
//   PW_LAB_ID        lab that owns the study (lab-scoped routes)
//   PW_FAIL_STUDY_ID a cal_ver/method_comparison study currently FAIL whose
//                    verdict flips to PASS when point PW_EXCLUDE_IDX is excluded
//   PW_EXCLUDE_IDX   0-based row index of the outlier to exclude (default 1)
//
// Run: PW_BASE=... PW_TOKEN=... PW_LAB_ID=3 PW_FAIL_STUDY_ID=... npx playwright test study-exclusion-verdict

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const STUDY_ID = process.env.PW_FAIL_STUDY_ID || "";
const IDX = process.env.PW_EXCLUDE_IDX || "1";
const resultsPath = (id: string) => (LAB_ID ? `/labs/${LAB_ID}/study/${id}/results` : `/study/${id}/results`);

test.describe("VeritaCheck exclusion verdict gate", () => {
  test("excluding an outlier that flips FAIL->PASS requires a justification, then lands", async ({ page }) => {
    test.skip(!TOKEN || !STUDY_ID, "PW_TOKEN + PW_FAIL_STUDY_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${resultsPath(STUDY_ID)}`);

    // Open the Manage data points dialog.
    await expect(page.getByTestId("open-point-exclusion-dialog")).toBeVisible({ timeout: 15000 });
    await page.getByTestId("open-point-exclusion-dialog").click();
    await expect(page.getByTestId("point-exclusion-dialog")).toBeVisible();

    // If a prior run left the point excluded, restore it first.
    const includeBtn = page.getByTestId(`exclusion-include-${IDX}`);
    if (await includeBtn.isVisible().catch(() => false)) {
      await includeBtn.click();
      await expect(page.getByTestId(`exclusion-exclude-${IDX}`)).toBeVisible({ timeout: 10000 });
    }

    // Exclude the outlier -> per-point reason.
    await page.getByTestId(`exclusion-exclude-${IDX}`).click();
    await expect(page.getByTestId("exclusion-reason-form")).toBeVisible();
    await page.getByTestId("exclusion-reason-input").fill("Playwright outlier (clotted specimen)");
    await page.getByTestId("exclusion-reason-submit").click();

    // Verdict flips FAIL -> PASS: the justification step appears (the gate).
    await expect(page.getByTestId("verdict-justify-form")).toBeVisible({ timeout: 15000 });
    // Confirm is disabled until a justification is typed.
    const confirm = page.getByTestId("verdict-justify-submit");
    await expect(confirm).toBeDisabled();
    await page.getByTestId("verdict-justify-input").fill("Director-approved exclusion: confirmed outlier, repeat within criteria.");
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // The exclusion landed: the row now reads Excluded.
    await expect(page.getByTestId(`exclusion-row-${IDX}`)).toContainText("Excluded", { timeout: 15000 });

    // Cleanup: restore the point so the study returns to its FAIL baseline.
    await page.getByTestId(`exclusion-include-${IDX}`).click();
    await expect(page.getByTestId(`exclusion-exclude-${IDX}`)).toBeVisible({ timeout: 15000 });
  });
});
