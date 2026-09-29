// tests/playwright/veritapolicy-print-view.spec.ts
//
// Gate 3 step 8 for parking-lot #39.5: the VeritaPolicy Compliance Dashboard
// print view. Verifies the Print button renders, and that under PRINT media the
// app chrome (.no-print: tabs + action buttons) is dropped while the dashboard
// (#compliance-print-area) stays visible, i.e. the @media print rules take hold.
// Env-gated: set PW_TOKEN (owner/admin) and PW_LAB_ID to run; skips otherwise.
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritapolicy-print-view

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID || "3";

test.describe("VeritaPolicy Compliance print view (#39.5)", () => {
  test.beforeEach(() => test.skip(!TOKEN, "set PW_TOKEN (owner/admin) to run the print-view check."));

  test("print button renders; print media hides chrome and keeps the dashboard", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/compliance`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // The Print button and the print-area container render.
    const printBtn = page.locator('[data-testid="compliance-print-btn"]');
    await expect(printBtn).toBeVisible({ timeout: 8000 });
    await expect(page.locator("#compliance-print-area")).toHaveCount(1);

    // The action bar (.no-print) that holds the button is visible on screen.
    const actionBar = printBtn.locator("xpath=ancestor::div[contains(@class,'no-print')][1]");
    await expect(actionBar).toBeVisible();

    // Under print media, .no-print is dropped but the dashboard section stays.
    await page.emulateMedia({ media: "print" });
    await expect(actionBar).toBeHidden();
    await expect(page.locator("#compliance-print-area")).toBeVisible();
    await page.emulateMedia({ media: "screen" });

    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
