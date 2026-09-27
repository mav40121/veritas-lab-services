// tests/playwright/staff-portal-competency-self-edit.spec.ts
//
// Gate 3 step 8 for VeritaComp employee self-edit (Part B). A staff-portal user
// can now add the factual data on their OWN unsigned competency (specimen IDs,
// dates, evidence, sample refs, quiz refs) before signing. The observer, the
// Pass verdict, and the evaluator stay the evaluator's. This drives the real
// Staff Portal flow: open Sign Competencies -> open an assessment -> Add my
// information -> Save -> saved confirmation.
//
// Env-gated: PW_STAFF_TOKEN (a real user JWT that qualifies for the Staff Portal:
// a staff_portal seat, or a staff_employees row linked by user_id) + PW_LAB_ID.
// Skips otherwise. The account must have at least one UNSIGNED technical
// competency on file.
//
//   PW_STAFF_TOKEN=... PW_LAB_ID=3 npx playwright test staff-portal-competency-self-edit

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_STAFF_TOKEN;

test.describe("Staff Portal: employee self-edits their own competency data", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN, "Set PW_STAFF_TOKEN (a Staff-Portal-qualifying JWT) to run the self-edit check.");
  });

  test("Add my information saves a specimen ID on an unsigned assessment", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/staff-access`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Open the Sign Competencies module.
    const compTile = page.getByText(/Sign Competencies/i).first();
    const hasTile = await compTile.isVisible().catch(() => false);
    test.skip(!hasTile, "Staff Portal has no Competencies tile for this account.");
    await compTile.click();
    await page.waitForTimeout(1500);

    // Open the first assessment in the list.
    const firstRow = page.locator('[data-testid="sp-competency-list"] button, [data-testid="sp-competency-list"] [role="button"]').first();
    if (await firstRow.isVisible().catch(() => false)) await firstRow.click();
    await page.waitForTimeout(1500);

    const myInfo = page.locator('[data-testid="sp-competency-myinfo"]');
    const hasMyInfo = await myInfo.isVisible().catch(() => false);
    test.skip(!hasMyInfo, "No unsigned technical assessment with editable data for this account.");

    const specimen = page.locator('[data-testid="sp-myinfo-el1-specimen"]').first();
    await expect(specimen).toBeVisible({ timeout: 8000 });
    const val = `SP-${Date.now().toString().slice(-6)}`;
    await specimen.fill(val);
    await page.locator('[data-testid="sp-myinfo-save"]').click();

    // Saved confirmation appears (the PUT succeeded).
    await expect(page.locator('[data-testid="sp-myinfo-saved"]')).toBeVisible({ timeout: 10000 });
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
