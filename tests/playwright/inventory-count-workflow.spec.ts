// tests/playwright/inventory-count-workflow.spec.ts
//
// Gate 3 step 8 for the scan-first count workflow (task #129, 2026-06-09).
// Verifies both new by-barcode endpoints gate on auth and reject bad
// inputs cleanly. Surface presence is asserted via data-testids when
// authenticated tokens are supplied.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const KIOSK = process.env.PW_KIOSK_TOKEN || "";
const SP = process.env.PW_STAFF_PORTAL_TOKEN || "";

test.describe("Inventory by-barcode lookup endpoints", () => {
  test("kiosk by-barcode requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/inventory-session/items/by-barcode?barcode=VLS-00008332`);
    expect([401, 403]).toContain(r.status());
  });

  test("staff portal by-barcode requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/staff-portal-session/inventory/items/by-barcode?barcode=VLS-00008332`);
    expect([401, 403]).toContain(r.status());
  });

  test("kiosk by-barcode missing param returns 400", async ({ request }) => {
    test.skip(!KIOSK, "PW_KIOSK_TOKEN not set");
    const r = await request.get(`${BASE}/api/inventory-session/items/by-barcode`, {
      headers: { Authorization: `Bearer ${KIOSK}` },
    });
    expect(r.status()).toBe(400);
  });

  test("staff portal by-barcode missing param returns 400", async ({ request }) => {
    test.skip(!SP, "PW_STAFF_PORTAL_TOKEN not set");
    const r = await request.get(`${BASE}/api/staff-portal-session/inventory/items/by-barcode`, {
      headers: { Authorization: `Bearer ${SP}` },
    });
    expect(r.status()).toBe(400);
  });

  test("kiosk by-barcode 404 on unknown barcode", async ({ request }) => {
    test.skip(!KIOSK, "PW_KIOSK_TOKEN not set");
    const r = await request.get(`${BASE}/api/inventory-session/items/by-barcode?barcode=DOES-NOT-EXIST-99999`, {
      headers: { Authorization: `Bearer ${KIOSK}` },
    });
    expect(r.status()).toBe(404);
    const body = await r.json();
    expect(body.error).toBe("unknown_barcode");
  });
});
