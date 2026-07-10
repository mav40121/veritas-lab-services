// tests/playwright/veritamap-no-mayo-in-howto.spec.ts
//
// Gate 3 step 8 evidence for removing the Mayo critical-values feature from
// VeritaMap (Michael, 2026-07-10). The VeritaMap pages are behind auth, so this is
// compile-only in CI and runs live only when PW_TOKEN is provided. It asserts the
// rendered How-To card no longer promises "Mayo Clinic Laboratories" critical
// values, while the Resources tab still surfaces the Mayo reference LINK (kept).
//
// Env: PW_BASE (default prod www), PW_TOKEN (lab-user JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaMap: Mayo removed from How-To, kept as Resources link", () => {
  test("How-To card has no Mayo critical-value promise; Resources keeps the link", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritamap/resources`, { waitUntil: "networkidle" });

    // The How-To card must not source critical values from Mayo anymore.
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("from Mayo Clinic Laboratories");
    expect(body).toContain("critical values");

    // The Resources reference link to Mayo's published thresholds is preserved.
    const mayoLink = page.locator('a[href*="mayocliniclabs.com/test-catalog/overview/63264"]');
    await expect(mayoLink).toHaveCount(1);
  });
});
