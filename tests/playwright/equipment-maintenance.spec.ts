// tests/playwright/equipment-maintenance.spec.ts
//
// Gate 3 step 8 for MLC-1 (equipment / instrument maintenance module,
// EquipmentAppPage). The page lists a lab's instruments with a maintenance
// status (overdue / due-soon / on-schedule), an "Add instrument" action, and a
// per-instrument "Log maintenance" flow.
//
// Gated on PW_TOKEN + PW_EQUIP_URL (e.g. /labs/19/equipment-app). Compile-only in
// CI; the live click is the human-in-the-loop receipt.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const EQUIP_URL = process.env.PW_EQUIP_URL || ""; // e.g. /labs/19/equipment-app

test.describe("Equipment maintenance module", () => {
  test("the page renders with the Add instrument action and instruments card", async ({ page }) => {
    if (!TOKEN || !EQUIP_URL) { test.skip(true, "Set PW_TOKEN + PW_EQUIP_URL."); return; }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}${EQUIP_URL}`, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { name: "Equipment Maintenance" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add instrument" })).toBeVisible();
    await expect(page.getByText("Instruments", { exact: true })).toBeVisible();

    // The add-instrument dialog opens and exposes the required name field.
    await page.getByRole("button", { name: "+ Add instrument" }).click();
    await expect(page.getByText("Instrument name")).toBeVisible();
  });
});
