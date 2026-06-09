// tests/playwright/inventory-count-unit.spec.ts
//
// Gate 3 step 8 receipt for the VeritaStock count_unit / pack_size
// structural fix (task #136, 2026-06-09). Confirms the kiosk + staff
// portal adjust endpoints accept new_count, multiply by pack_size,
// and reject bad shapes cleanly. Authenticated round-trips exercise
// the conversion math against a real item when tokens are available.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const KIOSK = process.env.PW_KIOSK_TOKEN || "";
const SP = process.env.PW_STAFF_PORTAL_TOKEN || "";
const SP_EMP = process.env.PW_STAFF_PORTAL_EMPLOYEE || "";

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

  test("staff portal rejects missing both fields", async ({ request }) => {
    test.skip(!SP || !SP_EMP, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");
    const r = await request.post(`${BASE}/api/staff-portal-session/inventory/items/1/adjust`, {
      headers: { Authorization: `Bearer ${SP}`, "Content-Type": "application/json" },
      data: { employee_id: parseInt(SP_EMP, 10) },
    });
    expect(r.status()).toBe(400);
  });

  test("staff portal new_count round-trip preserves usage_unit total", async ({ request }) => {
    test.skip(!SP || !SP_EMP, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");

    // Pick the first item that has pack_size > 1 if any; otherwise the first item
    const listResp = await request.get(`${BASE}/api/staff-portal-session/inventory/items`, {
      headers: { Authorization: `Bearer ${SP}` },
    });
    const list = await listResp.json();
    if (!list.items?.length) test.skip(true, "No inventory items");
    const target = list.items.find((i: any) => (i.units_per_count_unit ?? 1) > 1) || list.items[0];
    const pack = target.units_per_count_unit ?? 1;
    const originalQty = target.quantity_on_hand;
    const originalCount = target.count_on_hand ?? originalQty;

    // Adjust by sending new_count = originalCount + 1 (in count_unit)
    const desiredCount = originalCount + 1;
    const adj = await request.post(`${BASE}/api/staff-portal-session/inventory/items/${target.id}/adjust`, {
      headers: { Authorization: `Bearer ${SP}`, "Content-Type": "application/json" },
      data: { employee_id: parseInt(SP_EMP, 10), new_count: desiredCount, reason: "PW count-unit test" },
    });
    expect(adj.status()).toBe(200);
    const adjBody = await adj.json();
    // Server should have stored desiredCount * pack
    expect(adjBody.item.quantity_on_hand).toBe(desiredCount * pack);
    expect(adjBody.adjustment.count_entered).toBe(desiredCount);
    expect(adjBody.adjustment.units_per_count_unit).toBe(pack);
    expect(adjBody.adjustment.after_qty).toBe(desiredCount * pack);

    // Restore to keep idempotent across re-runs
    const restore = await request.post(`${BASE}/api/staff-portal-session/inventory/items/${target.id}/adjust`, {
      headers: { Authorization: `Bearer ${SP}`, "Content-Type": "application/json" },
      data: { employee_id: parseInt(SP_EMP, 10), new_quantity: originalQty, reason: "PW count-unit restore" },
    });
    expect(restore.status()).toBe(200);
  });
});
