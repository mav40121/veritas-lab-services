// Gate 3 step 8 for bulk add-to-sign-off-group from the Coverage map. Filters the
// Cal Ver / Linearity table to "Covered", selects a groupable row, and asserts the
// floating batch bar + "Add N to sign-off group" dropdown appear. Non-mutating: it
// opens the dropdown but does not commit, so it is safe against live data.
// Env: PW_BASE, PW_TOKEN, PW_COVERAGE_PATH (e.g. /labs/2/veritacheck/coverage for a
// lab that has at least one covered study not yet in a sign-off group).
import { test, expect, type Page } from "@playwright/test";
const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const COVERAGE_PATH = process.env.PW_COVERAGE_PATH || "";
async function auth(page: Page) {
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}
test.describe("Coverage map bulk add to sign-off group", () => {
  test("selecting a covered row reveals the batch add-to-group control", async ({ page }) => {
    test.skip(!TOKEN || !COVERAGE_PATH, "PW_TOKEN + PW_COVERAGE_PATH required");
    await auth(page);
    await page.goto(`${BASE}${COVERAGE_PATH}`);
    // Show covered rows (the default view hides them behind "Needs attention").
    await page.getByTestId("lin-status-filter").click();
    await page.getByRole("option", { name: "Covered", exact: true }).click();
    // A groupable covered row exposes a selection checkbox.
    const firstSelect = page.locator('[data-testid^="cov-select-"]').first();
    await firstSelect.waitFor({ timeout: 15000 });
    await firstSelect.click();
    // Floating batch bar appears with the add control.
    await expect(page.getByTestId("cov-bulk-bar")).toContainText("selected");
    const addBtn = page.getByTestId("button-bulk-add-group");
    await expect(addBtn).toBeEnabled();
    await expect(addBtn).toContainText("sign-off group");
    // Dropdown opens with a New group option. Non-mutating: we do not commit.
    await addBtn.click();
    await expect(page.getByTestId("bulk-new-group")).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
