// tests/playwright/cusum-relocate-to-veritaqc.spec.ts
//
// Gate 3 step 8 (browser) evidence for relocating the CUMSUM entry point off the
// VeritaCheck top nav and into VeritaQC (PR #951). Two customer-visible effects:
//   1. VeritaCheck's New Study top-nav no longer shows a "CUMSUM Monitoring" tab.
//   2. VeritaQC shows an "Open CUMSUM" card (testid veritaqc-cumsum-link) that
//      navigates to the unchanged /labs/:labId/veritacheck/cumsum tracker page.
//
// Drives the actual pages: asserts the tab is gone from VeritaCheck, then on
// VeritaQC clicks the new card and asserts it lands on the CUMSUM tracker.
// Non-mutating. Needs PW_TOKEN (a lab user with VeritaCheck + VeritaQC) +
// PW_LAB_ID; skips otherwise (compile-only in CI, real drive locally on prod).
//
// Env: PW_BASE (default production www), PW_TOKEN, PW_LAB_ID (default 2 = San Carlos).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("CUMSUM relocation: off VeritaCheck nav, into VeritaQC", () => {
  test("VeritaCheck New Study has no CUMSUM tab", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "domcontentloaded" });

    // The three remaining top-nav tabs still render.
    await expect(page.getByRole("link", { name: /My Studies/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: /Instrument Verification/i })).toBeVisible();

    // The CUMSUM Monitoring tab is gone from this bar.
    await expect(page.getByRole("link", { name: /CUMSUM Monitoring/i })).toHaveCount(0);
  });

  test("VeritaQC shows Open CUMSUM card that opens the tracker", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-app`, { waitUntil: "domcontentloaded" });

    const link = page.getByTestId("veritaqc-cumsum-link");
    await expect(link).toBeVisible({ timeout: 15000 });

    await link.click();
    // Lands on the unchanged CUMSUM tracker route/page.
    await expect(page).toHaveURL(/\/veritacheck\/cumsum/);
    await expect(page.getByText(/CUMSUM/i).first()).toBeVisible();
  });
});
