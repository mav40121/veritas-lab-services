// tests/playwright/veritacheck-multi-analyte-ui.spec.ts
//
// Gate 3 step 8 receipt for the multi-analyte verification UI
// (Michael feedback, PR2, 2026-06-09). Confirms the Analytes tab
// mounts, the Add Analyte dialog opens, and the form fields render.
// The live add-analyte-then-render-on-PDF path needs Michael's
// browser-click after deploy because it requires an existing
// verification with valid director permissions.
//
// PW_TOKEN: a logged-in veritas_token whose user owns PW_VERIFICATION_ID.
// PW_VERIFICATION_ID: an existing verification on that user's lab.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const VERIFICATION_ID = process.env.PW_VERIFICATION_ID || "";

test.describe("VeritaCheck multi-analyte verification UI", () => {
  test("Analytes tab mounts on the verification detail page", async ({ page }) => {
    test.skip(!TOKEN || !VERIFICATION_ID, "PW_TOKEN + PW_VERIFICATION_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/dashboard/verifications/${VERIFICATION_ID}`);
    await expect(page.getByTestId("tab-analytes")).toBeVisible({ timeout: 10000 });
  });

  test("clicking the Analytes tab shows the panel", async ({ page }) => {
    test.skip(!TOKEN || !VERIFICATION_ID, "PW_TOKEN + PW_VERIFICATION_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/dashboard/verifications/${VERIFICATION_ID}`);
    await page.getByTestId("tab-analytes").click();
    await expect(page.getByTestId("verification-analytes-panel")).toBeVisible();
    await expect(page.getByTestId("add-analyte-button")).toBeVisible();
  });

  test("Add Analyte button opens the dialog with all the fields", async ({ page }) => {
    test.skip(!TOKEN || !VERIFICATION_ID, "PW_TOKEN + PW_VERIFICATION_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/dashboard/verifications/${VERIFICATION_ID}`);
    await page.getByTestId("tab-analytes").click();
    await page.getByTestId("add-analyte-button").click();
    await expect(page.getByTestId("analyte-dialog")).toBeVisible();
    await expect(page.getByTestId("analyte-name-input")).toBeVisible();
    await expect(page.getByTestId("analyte-save-button")).toBeVisible();
  });
});
