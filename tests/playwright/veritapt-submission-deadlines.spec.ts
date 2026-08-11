// tests/playwright/veritapt-submission-deadlines.spec.ts
//
// Gate 3 step 8 for MLC-2 (PT submission-deadline tracking, VeritaPTAppPage).
// The Record PT Event modal gains a "Submission due date" field, and a
// deadline banner surfaces pending events that are overdue or due within 14
// days (a missed PT submission is a hard CLIA failure under 42 CFR 493.803).
//
// Gated on PW_TOKEN + PW_PT_URL (e.g. /labs/19/veritapt-app). Compile-only in CI;
// the live click is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PT_URL = process.env.PW_PT_URL || ""; // e.g. /labs/19/veritapt-app

test.describe("VeritaPT submission deadlines", () => {
  test("Record PT Event modal exposes a Submission due date field", async ({ page }) => {
    if (!TOKEN || !PT_URL) { test.skip(true, "Set PW_TOKEN + PW_PT_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${PT_URL}`, { waitUntil: "networkidle" });

    // Open the event entry modal and confirm the new deadline field is present.
    await page.getByRole("button", { name: "Record PT Event" }).click();
    await expect(page.getByText("Submission due date")).toBeVisible();

    // The deadline banner is conditional (only when pending events are overdue
    // or due within 14 days). If present, it names the CLIA basis.
    const banner = page.getByText(/PT submission deadlines: \d+ overdue/);
    if (await banner.count()) {
      await expect(page.getByText(/42 CFR 493\.803/)).toBeVisible();
    }
  });
});
