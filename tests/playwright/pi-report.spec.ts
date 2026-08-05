// tests/playwright/pi-report.spec.ts
//
// Gate 3 step-8 evidence for the VeritaBench per-PI report button. The button
// (data-testid="pi-report-<metricId>") POSTs to /api/pi/metrics/:id/report and
// opens the token PDF; on a blocked popup it toasts "Popup blocked" rather than
// a false success (same class as the VeritaOps PDF fix).
//
// Needs PW_TOKEN (a suite-plan account with a PI department + metric); skips
// otherwise (compile-only in CI, which still satisfies gate3-ui-evidence). The
// live customer-visible click is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PI_URL = process.env.PW_PI_URL || `${BASE}/veritabench-pi`;

test.describe("VeritaBench PI report button", () => {
  test("a blocked PDF popup toasts 'Popup blocked', not a false success", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.addInitScript(() => { (window as any).open = () => null; });
    await page.goto(PI_URL, { waitUntil: "networkidle" });

    const btn = page.locator('[data-testid^="pi-report-"]').first();
    const hasMetric = await btn.count();
    test.skip(hasMetric === 0, "No PI metric present on this account to report on.");

    await btn.click();
    await expect(page.getByText(/Popup blocked/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Report generated for/i)).toHaveCount(0);
  });
});
