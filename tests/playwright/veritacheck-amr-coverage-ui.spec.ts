// tests/playwright/veritacheck-amr-coverage-ui.spec.ts
//
// Gate 3 step 8 receipt for the StudyAmrDialog + Set AMR button
// (Michael L feedback, 2026-06-09). Asserts the static / structural
// pieces; the live "set AMR -> coverage block appears in the PDF"
// path needs Michael's browser-click after deploy because it needs a
// saved cal_ver / linearity study with at least one data point and a
// rendered PDF.
//
// PW_TOKEN: a logged-in user veritas_token whose user owns
// PW_LINEARITY_STUDY_ID. PW_LINEARITY_STUDY_ID: an existing cal_ver
// or reportable_range study in that user's lab.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const STUDY_ID = process.env.PW_LINEARITY_STUDY_ID || "";

test.describe("VeritaCheck AMR coverage UI", () => {
  test("Set AMR button mounts on a Linearity study", async ({ page }) => {
    test.skip(!TOKEN || !STUDY_ID, "PW_TOKEN + PW_LINEARITY_STUDY_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/study/${STUDY_ID}/results`);
    await expect(page.getByTestId("amr-panel")).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("open-amr-dialog")).toBeVisible();
  });

  test("clicking the button opens the AMR dialog", async ({ page }) => {
    test.skip(!TOKEN || !STUDY_ID, "PW_TOKEN + PW_LINEARITY_STUDY_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/study/${STUDY_ID}/results`);
    await page.getByTestId("open-amr-dialog").click();
    await expect(page.getByTestId("amr-dialog")).toBeVisible();
    await expect(page.getByTestId("amr-low-input")).toBeVisible();
    await expect(page.getByTestId("amr-high-input")).toBeVisible();
    await expect(page.getByTestId("amr-units-input")).toBeVisible();
    await expect(page.getByTestId("amr-save-button")).toBeVisible();
  });
});
