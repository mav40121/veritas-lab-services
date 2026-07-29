// Gate 3 step 8 for the VeritaScan -> VeritaPolicy link. Opens the document
// library, opens a document's edit drawer, and asserts the "Linked Policy"
// section + picker appear. Non-mutating: it opens the picker but does not
// commit a link, so it is safe against live data.
// Env: PW_BASE, PW_TOKEN, PW_SCAN_DOCS_PATH (e.g. /labs/2/veritascan/documents
// for a lab that has at least one VeritaScan document).
import { test, expect, type Page } from "@playwright/test";
const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PATH = process.env.PW_SCAN_DOCS_PATH || "";
async function auth(page: Page) {
  await page.goto(BASE);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}
test.describe("VeritaScan link to a VeritaPolicy policy", () => {
  test("the edit drawer exposes a Linked Policy section and picker", async ({ page }) => {
    test.skip(!TOKEN || !PATH, "PW_TOKEN + PW_SCAN_DOCS_PATH required");
    await auth(page);
    await page.goto(`${BASE}${PATH}`);
    const editBtn = page.locator('[data-testid^="button-edit-"]').first();
    await editBtn.waitFor({ timeout: 15000 });
    await editBtn.click();
    // The drawer now shows the Linked Policy section.
    const linkBtn = page.getByTestId("button-open-policy-picker");
    await expect(linkBtn).toBeVisible();
    // Opening the picker lists the lab's VeritaPolicy policies (or an empty state).
    await linkBtn.click();
    await expect(page.getByText("Link a VeritaPolicy policy")).toBeVisible({ timeout: 10000 });
    // Non-mutating: close without committing a link.
    await page.keyboard.press("Escape");
  });
});
