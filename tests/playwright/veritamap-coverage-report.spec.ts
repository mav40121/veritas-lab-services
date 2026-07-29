// tests/playwright/veritamap-coverage-report.spec.ts
//
// Gate 3 step 8 for LHF-2: one surveyor-ready Coverage Report export from the
// whole-lab menu. Drives the labwide page and asserts the "Coverage Report"
// export button renders (the whole-lab menu had no export before this).
//
// Env: PW_BASE, PW_TOKEN, PW_LABWIDE_PATH (e.g. /labs/3/veritamap-app/labwide).
// Skips cleanly when creds/path are absent.

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LABWIDE_PATH = process.env.PW_LABWIDE_PATH || "";

async function auth(page: Page) {
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}

test.describe("VeritaMap whole-lab Coverage Report export (LHF-2)", () => {
  test("labwide page shows the Coverage Report export button", async ({ page }) => {
    test.skip(!TOKEN || !LABWIDE_PATH, "PW_TOKEN + PW_LABWIDE_PATH required");
    await auth(page);
    await page.goto(`${BASE}${LABWIDE_PATH}`);
    await expect(page.getByRole("button", { name: /Coverage Report/i })).toBeVisible({ timeout: 15000 });
  });
});
