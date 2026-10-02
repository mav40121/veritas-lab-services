// tests/playwright/veritascan-custom-scan-section.spec.ts
//
// Gate 3 step 8 browser evidence for parking-lot #55 phase 3: a scan surfaces the
// lab's custom questions in a separate "Custom / site-specific" section that is
// scored on its own and excluded from the standardized readiness %.
// (client/src/pages/VeritaScanScanPage.tsx, CustomQuestionsSection.)
//
// Env: PW_BASE, PW_TOKEN (a writer on a lab with VeritaScan AND at least one
// active custom question), PW_SCAN_LAB (that lab's id), PW_SCAN_ID (a scan id in
// that lab). Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_SCAN_LAB || "";
const SCAN = process.env.PW_SCAN_ID || "";

test.describe("VeritaScan custom questions in a scan", () => {
  test("the Custom / site-specific section renders and is flagged out of the standardized score", async ({ page }) => {
    if (!TOKEN || !LAB || !SCAN) {
      test.skip(true, "Needs PW_TOKEN + PW_SCAN_LAB + PW_SCAN_ID (a scan in a lab with active custom questions).");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritascan-app/${SCAN}`, { waitUntil: "domcontentloaded" });

    // The separate section and its disclaimer are present.
    await expect(page.getByText(/Custom \/ site-specific/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/not included in the standardized readiness score/i)).toBeVisible();
  });
});
