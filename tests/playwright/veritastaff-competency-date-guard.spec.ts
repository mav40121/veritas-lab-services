// tests/playwright/veritastaff-competency-date-guard.spec.ts
//
// Gate 3 step 8 browser exercise for the VeritaStaff competency date guard.
// A native date input (or paste) could yield a 1-4 digit year, so a mistyped
// competency date came in as year 0002 (Troy / Rachel 2026-09-18). The dialog
// now sets min/max on the date inputs and blocks an implausible year before
// saving; the server rejects it too.
//
// Opens the first employee's Competency dialog, asserts the completed-date
// input is bounded (min 1950), enters a bad-year date, and confirms Save is
// blocked with the "Check the date" toast and no PUT is sent. The competency
// PUT is stubbed so nothing real is written.
//
// Env: PW_BASE, PW_TOKEN (a VeritaStaff owner/admin), PW_STAFF_LAB (a lab with
// at least one employee). Skips without them so the compile-only smoke gate
// stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_STAFF_LAB || "";

test.describe("VeritaStaff — competency date guard", () => {
  test("blocks an implausible year before saving", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_STAFF_LAB (a lab with an employee).");
      return;
    }

    // Stub the competency PUT so a click never writes real data, and record it.
    const putCalls: string[] = [];
    await page.route(/\/api\/labs\/\d+\/staff\/competency\/\d+/, async route => {
      putCalls.push(route.request().postData() || "");
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastaff-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Open the first employee, then the Competency Schedule dialog.
    await page.getByText(/Update|Competency/i).first().waitFor({ timeout: 8000 }).catch(() => {});
    const updateBtn = page.getByRole("button", { name: /Update/i }).first();
    await updateBtn.click().catch(() => {});
    // The dialog title confirms we are in the competency editor.
    await expect(page.getByText(/Competency Schedule:/i)).toBeVisible({ timeout: 8000 });

    const dateInput = page.locator('input[type="date"]').first();
    await expect(dateInput).toHaveAttribute("min", "1950-01-01");

    // Enter a bad-year date and try to save.
    await dateInput.fill("0002-09-01");
    await page.getByRole("button", { name: /^Save$/ }).click();

    // The guard must show the "Check the date" toast and must NOT send the PUT.
    await expect(page.getByText(/Check the date/i)).toBeVisible({ timeout: 5000 });
    expect(putCalls.length, "no competency PUT fired for an implausible year").toBe(0);
  });
});
