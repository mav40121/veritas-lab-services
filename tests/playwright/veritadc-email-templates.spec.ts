// tests/playwright/veritadc-email-templates.spec.ts
//
// Gate 3 browser evidence for customizable review-reminder email templates
// (#39). "My Documents" has a "Reminder emails" button that opens a dialog with
// the three reminder templates (30-day warning / overdue / final), each with an
// editable subject + HTML body, merge-field legend, Save, and Reset-to-default.
//
// Env: PW_BASE, PW_TOKEN (owner/admin), PW_DC_LAB. Skips without them.
//
// Manually exercised on a local throwaway lab on 2026-10-04: opened the dialog
// (3 template blocks + merge-field legend rendered), edited the 30-day subject
// and clicked Save; the API then returned that template with is_custom=true and
// the new subject, while "overdue" stayed default. Render logic covered by
// scripts/verify-veritadc-email-templates.ts (9/9).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_DC_LAB || "";

test.describe("VeritaDC - customizable reminder email templates", () => {
  test("the Reminder emails dialog shows the three editable templates", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN (owner/admin) + PW_DC_LAB.");
      return;
    }
    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/my-policies`, { waitUntil: "domcontentloaded" });

    await page.getByRole("button", { name: /Reminder emails/i }).click();
    await expect(page.getByText(/Review-reminder emails/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId("email-template-30_day_warning")).toBeVisible();
    await expect(page.getByTestId("email-template-overdue")).toBeVisible();
    await expect(page.getByTestId("email-template-final")).toBeVisible();
    await expect(page.getByTestId("save-template-30_day_warning")).toBeVisible();
  });
});
