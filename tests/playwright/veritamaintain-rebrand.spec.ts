// tests/playwright/veritamaintain-rebrand.spec.ts
//
// Gate 3 step 8 browser exercise for the VeritaMaintain rebrand. The live
// "Equipment Maintenance" module (equipment register + maintenance/function-
// check event log + reminders) was rebranded to VeritaMaintain(TM); its data,
// API, and reminder engine are unchanged. This asserts the module page now
// presents as VeritaMaintain and no longer shows the old "Equipment
// Maintenance" name.
//
// Env: PW_BASE, PW_TOKEN (a subscribed owner/admin), PW_QC_LAB (a subscribed
// lab). Skips without them so the compile-only smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_QC_LAB || "";

test.describe("VeritaMaintain — rebrand", () => {
  test("module page presents as VeritaMaintain, not Equipment Maintenance", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_QC_LAB (a subscribed lab).");
      return;
    }

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/equipment-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // The rebranded name is present (heading or subscription wall), and the old
    // module name is gone from the page body.
    await expect(page.getByText(/VeritaMaintain/).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByText("Equipment Maintenance", { exact: true })).toHaveCount(0);
  });
});
