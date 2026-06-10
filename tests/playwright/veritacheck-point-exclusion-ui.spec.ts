// tests/playwright/veritacheck-point-exclusion-ui.spec.ts
//
// Gate 3 step 8 receipt for the StudyPointExclusionDialog + Manage
// data points button (PR2 of the Michael L edit/exclude feedback,
// 2026-06-09). Asserts the static / structural pieces; the live
// "click Exclude on point 5 -> regression N drops by 1" path needs
// Michael's browser-click after deploy because it needs a saved
// method_comparison study with at least one data point.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const STUDY_ID = process.env.PW_METHOD_COMP_STUDY_ID || "";

test.describe("VeritaCheck point exclusion UI", () => {
  test("Manage data points button mounts on a method_comparison study", async ({ page }) => {
    test.skip(!TOKEN || !STUDY_ID, "PW_TOKEN + PW_METHOD_COMP_STUDY_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/study/${STUDY_ID}/results`);
    await expect(page.getByTestId("point-exclusion-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("open-point-exclusion-dialog")).toBeVisible();
  });

  test("clicking the button opens the exclusion dialog", async ({ page }) => {
    test.skip(!TOKEN || !STUDY_ID, "PW_TOKEN + PW_METHOD_COMP_STUDY_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/study/${STUDY_ID}/results`);
    await page.getByTestId("open-point-exclusion-dialog").click();
    await expect(page.getByTestId("point-exclusion-dialog")).toBeVisible();
  });
});
