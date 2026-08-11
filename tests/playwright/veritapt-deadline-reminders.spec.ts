// tests/playwright/veritapt-deadline-reminders.spec.ts
//
// Gate 3 step 8 for MLC-2b (VeritaPT deadline email reminders). The VeritaPT
// page gains a "PT deadline email reminders" settings panel: an Enabled toggle,
// a lead-days field, a recipients field, and a Save button. The nightly engine
// (server/ptReminders.ts) reads the per-lab config the panel writes.
//
// Gated on PW_TOKEN + PW_PT_URL (e.g. /labs/19/veritapt-app). Compile-only in CI;
// the live click is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const PT_URL = process.env.PW_PT_URL || ""; // e.g. /labs/19/veritapt-app

test.describe("VeritaPT deadline email reminders", () => {
  test("the reminders settings panel renders with its controls", async ({ page }) => {
    if (!TOKEN || !PT_URL) { test.skip(true, "Set PW_TOKEN + PW_PT_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${PT_URL}`, { waitUntil: "networkidle" });

    await expect(page.getByText("PT deadline email reminders")).toBeVisible();
    await expect(page.getByText("Remind within (days before due)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save reminder settings" })).toBeVisible();
  });
});
