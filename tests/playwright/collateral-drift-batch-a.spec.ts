// Gate 3 step 8 browser evidence for the Batch A collateral-drift copy fixes.
// Loads the affected PUBLIC marketing pages (no auth) and asserts the corrected
// copy renders and the stale copy is gone. Env-gated on PW_DRIFT_BASE so it does
// NOT run in the CI smoke job (which would hit the not-yet-deployed prod build);
// run it AFTER the deploy is ACTIVE:
//   PW_DRIFT_BASE=https://www.veritaslabservices.com npx playwright test collateral-drift-batch-a
import { test, expect, type Page } from "@playwright/test";
const BASE = process.env.PW_DRIFT_BASE || "";

async function bodyText(page: Page, path: string): Promise<string> {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

test.describe("Collateral drift Batch A: corrected copy on public pages", () => {
  test.skip(!BASE, "set PW_DRIFT_BASE to the deployed origin to run");

  test("pricing page shows individual sign-in, not the retired shared kiosk", async ({ page }) => {
    const t = await bodyText(page, "/pricing");
    expect(t).toContain("Individual email and password sign-in");
    expect(t).not.toContain("One shared lab kiosk login");
  });

  test("roadmap shows 269 instruments and the Mayo layer is gone", async ({ page }) => {
    const t = await bodyText(page, "/roadmap");
    expect(t).toContain("Maps 269 instruments");
    expect(t).not.toContain("Mayo Clinic Laboratories");
    expect(t).not.toContain("190+");
  });

  test("study guide advertises fourteen study types", async ({ page }) => {
    const t = await bodyText(page, "/study-guide");
    expect(t).toContain("fourteen study types");
    expect(t).not.toContain("eleven study types");
  });

  test("VeritaScan product page shows the $999 suite-entry price", async ({ page }) => {
    const t = await bodyText(page, "/veritascan");
    expect(t).toContain("$999");
    expect(t).not.toContain("$499");
  });

  test("VeritaMap product page shows the $999 suite-entry price", async ({ page }) => {
    const t = await bodyText(page, "/veritamap");
    expect(t).toContain("$999");
    expect(t).not.toContain("$499");
  });
});
