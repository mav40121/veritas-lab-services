// tests/playwright/inventory-count-unit.spec.ts
//
// Gate 3 step 8 receipt for the VeritaStock count_unit / pack_size
// structural fix (task #136, 2026-06-09). Confirms the kiosk + staff
// portal adjust endpoints accept new_count, multiply by pack_size,
// and reject bad shapes cleanly. Authenticated round-trips exercise
// the conversion math against a real item when tokens are available.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const KIOSK = process.env.PW_KIOSK_TOKEN || "";
const SP = process.env.PW_STAFF_PORTAL_TOKEN || "";
const SP_EMP = process.env.PW_STAFF_PORTAL_EMPLOYEE || "";

// UI display receipt (2026-06-16 fix): the desktop VeritaStock list must label
// On Hand in the item's count_unit whenever count_unit != usage_unit, at ANY
// pack size. Before the fix, items at pack_size = 1 (e.g. count_unit=box,
// usage_unit=each, 1 each/box) fell back to the usage_unit label ("3 eaches").
//   PW_TOKEN              writer bearer for the lab that owns the item
//   PW_LAB_ID            (optional) lab id for the lab-scoped /labs/:id route
//   PW_STOCK_ITEM_NAME   item to inspect (e.g. "Thermo Scientific MAS QC - AMON")
//   PW_STOCK_COUNT_UNIT  expected count-unit token in the On Hand cell (e.g. "box")
const UI_TOKEN = process.env.PW_TOKEN || "";
const UI_LAB = process.env.PW_LAB_ID || "";
const UI_ITEM = process.env.PW_STOCK_ITEM_NAME || "";
const UI_COUNT_UNIT = process.env.PW_STOCK_COUNT_UNIT || "";

test.describe("Inventory adjust accepts new_count + new_quantity", () => {
  test("kiosk rejects missing both new_count and new_quantity", async ({ request }) => {
    test.skip(!KIOSK, "PW_KIOSK_TOKEN not set");
    const r = await request.post(`${BASE}/api/inventory-session/items/1/adjust`, {
      headers: { Authorization: `Bearer ${KIOSK}`, "Content-Type": "application/json" },
      data: { initials: "PW" },
    });
    expect(r.status()).toBe(400);
  });

  test("kiosk rejects negative new_count", async ({ request }) => {
    test.skip(!KIOSK, "PW_KIOSK_TOKEN not set");
    const r = await request.post(`${BASE}/api/inventory-session/items/1/adjust`, {
      headers: { Authorization: `Bearer ${KIOSK}`, "Content-Type": "application/json" },
      data: { new_count: -1, initials: "PW" },
    });
    expect(r.status()).toBe(400);
  });
  // 2026-10-09: the two Staff Portal adjust tests were removed with the
  // /api/staff-portal-session/inventory routes (staff count in VeritaStock now).
});

test.describe("VeritaStock desktop On Hand displays in count_unit", () => {
  test("On Hand cell labels in the count unit, not the usage unit, at any pack size", async ({ page }) => {
    test.skip(!UI_TOKEN || !UI_ITEM || !UI_COUNT_UNIT, "PW_TOKEN + PW_STOCK_ITEM_NAME + PW_STOCK_COUNT_UNIT required");
    await injectAuth(page, BASE, UI_TOKEN);
    const stockPath = UI_LAB ? `/labs/${UI_LAB}/veritastock` : `/veritastock`;
    await page.goto(`${BASE}${stockPath}`);
    await page.waitForLoadState("networkidle");
    // Scope to the row carrying the item name, then assert its On Hand cell
    // (data-testid="onhand-cell") contains the configured count-unit token.
    const cell = page.locator("tr", { hasText: UI_ITEM }).first().locator('[data-testid="onhand-cell"]');
    await expect(cell).toBeVisible({ timeout: 15000 });
    await expect(cell).toContainText(UI_COUNT_UNIT);
  });
});
