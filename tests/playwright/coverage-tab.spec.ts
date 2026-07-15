// tests/playwright/coverage-tab.spec.ts
//
// Gate 3 step 8 (browser) evidence for the Coverage tab added to the VeritaCheck
// landing page study-tool tab bar (New Study / My Studies / Instrument
// Verification / Coverage). Coverage was reachable only via My Studies -> the
// dashboard; this puts it as a peer tab where users look.
//
// Drives the landing page: asserts the Coverage tab renders, clicks it, and
// asserts the URL lands on /veritacheck/coverage. Read-only, non-mutating.
// Needs PW_TOKEN + PW_LAB_ID; skips otherwise.
//
// Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID (default 2).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaCheck landing — Coverage tab", () => {
  test("Coverage tab renders in the tab bar and opens the Coverage page", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck`, { waitUntil: "domcontentloaded" });

    const tab = page.getByTestId("tab-coverage");
    await expect(tab).toBeVisible({ timeout: 20000 });
    await tab.click();
    await expect(page).toHaveURL(/\/veritacheck\/coverage/, { timeout: 15000 });
  });
});
