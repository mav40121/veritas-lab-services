// tests/playwright/inventory-count-workflow.spec.ts
//
// Gate 3 step 8 for the scan-first count workflow (task #129, 2026-06-09).
// The Wave K CLIA+PIN kiosk (/api/inventory-session/*) was removed 2026-09-30;
// the Staff Portal inventory endpoints (individual login) carry the same
// by-barcode lookup, so this verifies that surface gates on auth and rejects
// bad input cleanly.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SP = process.env.PW_STAFF_PORTAL_TOKEN || "";

test.describe("Inventory by-barcode lookup endpoints", () => {
  test("staff portal by-barcode requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/inventory/items/by-barcode?barcode=VLS-00008332`);
    expect([401, 403]).toContain(r.status());
  });

  test("staff portal by-barcode missing param returns 400", async ({ request }) => {
    test.skip(!SP, "PW_STAFF_PORTAL_TOKEN not set");
    const r = await request.get(`${BASE}/api/staff-portal-session/inventory/items/by-barcode`, {
      headers: { Authorization: `Bearer ${SP}` },
    });
    expect(r.status()).toBe(400);
  });
});
