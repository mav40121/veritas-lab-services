// tests/playwright/staff-portal-inventory.spec.ts
//
// Gate 3 step 8 for the Staff Portal inventory module (Wave K6, task
// #133, 2026-06-08). Confirms the two new staff-portal-session
// inventory endpoints gate cleanly on the staff-portal JWT and reject
// calls without it. Round-trip exercised when a staff-portal token is
// supplied via PW_STAFF_PORTAL_TOKEN.
//
// Env:
//   PW_BASE                  - base URL (default: prod)
//   PW_STAFF_PORTAL_TOKEN    - staff-portal JWT (optional)
//   PW_STAFF_PORTAL_EMPLOYEE - employee id with can_adjust_inventory=1

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SP_TOKEN = process.env.PW_STAFF_PORTAL_TOKEN || "";
const SP_EMPLOYEE = process.env.PW_STAFF_PORTAL_EMPLOYEE || "";

test.describe("Staff Portal inventory module", () => {
  test("items list requires staff-portal auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/inventory/items`);
    expect([401, 403]).toContain(r.status());
  });

  test("adjust endpoint requires staff-portal auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/staff-portal-session/inventory/items/1/adjust`, {
      data: { employee_id: 1, new_quantity: 5 },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("authenticated items list returns array shape", async ({ request }) => {
    test.skip(!SP_TOKEN, "PW_STAFF_PORTAL_TOKEN not set");
    const r = await request.get(`${BASE}/api/staff-portal-session/inventory/items`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.items)).toBe(true);
    if (body.items.length > 0) {
      const i = body.items[0];
      expect(typeof i.id).toBe("number");
      expect(typeof i.item_name).toBe("string");
      expect(typeof i.quantity_on_hand).toBe("number");
    }
  });

  test("adjust round-trip changes qty and restores", async ({ request }) => {
    test.skip(!SP_TOKEN || !SP_EMPLOYEE, "PW_STAFF_PORTAL_TOKEN / PW_STAFF_PORTAL_EMPLOYEE not set");

    const listResp = await request.get(`${BASE}/api/staff-portal-session/inventory/items`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}` },
    });
    const list = await listResp.json();
    if (!list.items?.length) test.skip(true, "No inventory items on this lab to exercise");

    const target = list.items[0];
    const originalQty = target.quantity_on_hand;
    const desiredQty = originalQty + 7;

    const adj = await request.post(`${BASE}/api/staff-portal-session/inventory/items/${target.id}/adjust`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}`, "Content-Type": "application/json" },
      data: { employee_id: parseInt(SP_EMPLOYEE, 10), new_quantity: desiredQty, reason: "Playwright round-trip test" },
    });
    expect(adj.status()).toBe(200);
    const adjBody = await adj.json();
    expect(adjBody.item.quantity_on_hand).toBe(desiredQty);
    expect(adjBody.adjustment.before_qty).toBe(originalQty);
    expect(adjBody.adjustment.after_qty).toBe(desiredQty);
    expect(adjBody.adjustment.delta).toBe(desiredQty - originalQty);

    // Restore so this test is idempotent across re-runs
    const restore = await request.post(`${BASE}/api/staff-portal-session/inventory/items/${target.id}/adjust`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}`, "Content-Type": "application/json" },
      data: { employee_id: parseInt(SP_EMPLOYEE, 10), new_quantity: originalQty, reason: "Playwright round-trip restore" },
    });
    expect(restore.status()).toBe(200);
  });

  test("adjust rejects bad payload shapes", async ({ request }) => {
    test.skip(!SP_TOKEN, "PW_STAFF_PORTAL_TOKEN not set");
    // negative qty -> 400
    const r1 = await request.post(`${BASE}/api/staff-portal-session/inventory/items/1/adjust`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}`, "Content-Type": "application/json" },
      data: { employee_id: 1, new_quantity: -1 },
    });
    expect(r1.status()).toBe(400);
    // missing employee_id -> 400
    const r2 = await request.post(`${BASE}/api/staff-portal-session/inventory/items/1/adjust`, {
      headers: { Authorization: `Bearer ${SP_TOKEN}`, "Content-Type": "application/json" },
      data: { new_quantity: 1 },
    });
    expect(r2.status()).toBe(400);
  });
});
