// tests/playwright/inventory-mutation-scope.spec.ts
//
// Gate 3 step 8 for the inventory mutation scope fix (2026-06-09).
// Reproduces Michael's "Item not found" on PUT for a seeded item:
// items list correctly via lab_id but PUT/DELETE used to filter by
// account_id alone and 404'd on seeded rows. After this fix, the
// PUT round-trip should succeed when the user is an active lab_member
// of the item's lab.
//
// Env:
//   PW_BASE   - base URL (default: prod)
//   PW_TOKEN  - user JWT (active lab_member of PW_LAB_ID)
//   PW_LAB_ID - lab id (default 3 = Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("Inventory mutation scope fix", () => {
  test("PUT round-trip on the lab's first listed item succeeds (was 404 before)", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set");

    const listResp = await request.get(`${BASE}/api/labs/${LAB_ID}/veritastock/items`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (listResp.status() !== 200) {
      // Older shape — try the alt route
      const alt = await request.get(`${BASE}/api/inventory`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      expect(alt.status()).toBe(200);
    }
    const items = listResp.status() === 200 ? await listResp.json() : [];
    if (!items?.length) test.skip(true, "No inventory items to exercise");

    const target = Array.isArray(items) ? items[0] : items.items?.[0];
    expect(target?.id).toBeTruthy();

    // PUT a no-op (set count_unit to its current value or "each")
    const putResp = await request.put(`${BASE}/api/inventory/${target.id}`, {
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      data: {
        ...target,
        count_unit: target.count_unit || "each",
        units_per_count_unit: target.units_per_count_unit || 1,
      },
    });
    // The fix flips the prior 404 to 200; 403 means the user isn't a
    // lab_member of the item's lab (env mis-set).
    expect([200]).toContain(putResp.status());
  });
});
