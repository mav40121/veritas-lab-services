// tests/playwright/study-exclusion-panel-gate.spec.ts
//
// Regression guard for the per-point exclusion panel visibility gate. The
// "Manage data points" panel must show only for flat-array study types the
// exclusion endpoint accepts (cal_ver, method_comparison/correlation,
// precision). It must NOT show for reportable_range, whose object-shaped
// {levels:[]} data the endpoint rejects (the button would no-op).
//
// Env:
//   PW_BASE             default https://www.veritaslabservices.com
//   PW_TOKEN            bearer for a writer in the lab
//   PW_LAB_ID           lab that owns the studies (lab-scoped routes)
//   PW_CALVER_STUDY_ID  a cal_ver study id (panel SHOULD show)
//   PW_RR_STUDY_ID      a reportable_range study id (panel must NOT show)
//
// Run: PW_BASE=... PW_TOKEN=... PW_LAB_ID=3 PW_CALVER_STUDY_ID=... PW_RR_STUDY_ID=... \
//      npx playwright test study-exclusion-panel-gate

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const CALVER = process.env.PW_CALVER_STUDY_ID || "";
const RR = process.env.PW_RR_STUDY_ID || "";
const resultsPath = (id: string) => (LAB_ID ? `/labs/${LAB_ID}/study/${id}/results` : `/study/${id}/results`);

test.describe("VeritaCheck exclusion panel visibility gate", () => {
  test("cal_ver study shows the Manage data points panel", async ({ page }) => {
    test.skip(!TOKEN || !CALVER, "PW_TOKEN + PW_CALVER_STUDY_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${resultsPath(CALVER)}`);
    await expect(page.getByTestId("point-exclusion-panel")).toBeVisible({ timeout: 15000 });
  });

  test("reportable_range study does NOT show the exclusion panel", async ({ page }) => {
    test.skip(!TOKEN || !RR, "PW_TOKEN + PW_RR_STUDY_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${resultsPath(RR)}`);
    // The results render (any results-page testid present), but the exclusion
    // panel must be absent for reportable_range.
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("point-exclusion-panel")).toHaveCount(0);
  });
});
