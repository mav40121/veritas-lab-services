// Gate 3 step 8 for LHF-3: reference-range / critical-value / AMR gap flags on
// the whole-lab menu. Drives the labwide page and asserts the "Missing reference
// range" gap tile renders.
// Env: PW_BASE, PW_TOKEN, PW_LABWIDE_PATH (e.g. /labs/3/veritamap-app/labwide).
import { test, expect, type Page } from "@playwright/test";
const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LABWIDE_PATH = process.env.PW_LABWIDE_PATH || "";
async function auth(page: Page) {
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}
test.describe("VeritaMap whole-lab menu gap flags (LHF-3)", () => {
  test("labwide page shows the Missing reference range gap tile", async ({ page }) => {
    test.skip(!TOKEN || !LABWIDE_PATH, "PW_TOKEN + PW_LABWIDE_PATH required");
    await auth(page);
    await page.goto(`${BASE}${LABWIDE_PATH}`);
    await expect(page.getByText("Missing reference range")).toBeVisible({ timeout: 15000 });
  });
});
