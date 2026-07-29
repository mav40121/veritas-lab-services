// Gate 3 step 8 for the My Studies sign-off group badge. Drives the dashboard
// (My Studies) page and asserts that a study already in a VeritaCheck sign-off
// group shows an always-visible "Sign-off group" badge. Root cause fixed here:
// studyRowToClient dropped signoff_group_id, so the membership cue never rendered.
// Env: PW_BASE, PW_TOKEN, PW_DASHBOARD_PATH (e.g. /labs/2/dashboard for a lab
// that has at least one study assigned to a sign-off group).
import { test, expect, type Page } from "@playwright/test";
const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const DASHBOARD_PATH = process.env.PW_DASHBOARD_PATH || "";
async function auth(page: Page) {
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}
test.describe("My Studies sign-off group badge", () => {
  test("a study in a sign-off group shows the group badge", async ({ page }) => {
    test.skip(!TOKEN || !DASHBOARD_PATH, "PW_TOKEN + PW_DASHBOARD_PATH required");
    await auth(page);
    await page.goto(`${BASE}${DASHBOARD_PATH}`);
    const badge = page.locator('[data-testid^="badge-signoff-group-"]').first();
    await expect(badge).toBeVisible({ timeout: 15000 });
    await expect(badge).toContainText("Sign-off group");
  });
});
