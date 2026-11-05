// Gate 3 step 8 browser evidence for Batch B collateral-drift copy fixes
// (D2 study-type leaflet copy, D3 VeritaCheck suite tile price, D5 SSO qualifier).
// Env-gated on PW_DRIFT_BASE so CI smoke skips it (prod not yet deployed); run
// AFTER the deploy is ACTIVE:
//   PW_DRIFT_BASE=https://www.veritaslabservices.com npx playwright test collateral-drift-batch-b
import { test, expect, type Page } from "@playwright/test";
const BASE = process.env.PW_DRIFT_BASE || "";

async function bodyText(page: Page, path: string): Promise<string> {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe("Collateral drift Batch B", () => {
  test.skip(!BASE, "set PW_DRIFT_BASE to the deployed origin to run");

  test("D2: resources leaflet card no longer claims 'all 6' study types", async ({ page }) => {
    const t = await bodyText(page, "/resources");
    expect(t).not.toContain("all 6 VeritaCheck");
    expect(t).toContain("core VeritaCheck");
  });

  test("D3: VeritaCheck suite tile shows the $999 suite-entry price", async ({ page }) => {
    const t = await bodyText(page, "/veritacheck");
    expect(t).toContain("From $999/yr");
    expect(t).not.toContain("From $499/yr");
  });

  test("D5: pricing annotates SSO as on request", async ({ page }) => {
    const t = await bodyText(page, "/pricing");
    expect(t).toContain("SSO (on request)");
  });
});
