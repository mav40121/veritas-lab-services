// tests/playwright/equipment-reminders.spec.ts
//
// Gate 3 step 8 for MLC-1 Phase 2 (equipment maintenance-due email reminders).
// The Equipment page gains a "Maintenance-due email reminders" settings panel:
// an Enabled toggle, a lead-days field, a recipients field, and a Save button.
// The nightly engine (server/equipmentReminders.ts) reads the per-lab config it
// writes.
//
// Gated on PW_TOKEN + PW_EQUIP_URL (e.g. /labs/19/equipment-app). Compile-only in
// CI; the live click is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const EQUIP_URL = process.env.PW_EQUIP_URL || "";

test.describe("Equipment maintenance-due reminders", () => {
  test("the reminders settings panel renders with its controls", async ({ page }) => {
    if (!TOKEN || !EQUIP_URL) { test.skip(true, "Set PW_TOKEN + PW_EQUIP_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${EQUIP_URL}`, { waitUntil: "networkidle" });

    await expect(page.getByText("Maintenance-due email reminders")).toBeVisible();
    await expect(page.getByText("Remind within (days before due)")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save reminder settings" })).toBeVisible();
  });
});
