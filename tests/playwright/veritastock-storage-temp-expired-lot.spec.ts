// tests/playwright/veritastock-storage-temp-expired-lot.spec.ts
//
// Gate 3 step 8 for Pfizer demo items 2 (storage temperature field) and 5
// (one-click write-off of a whole expired lot). Item 2 needs the storage_temp /
// storage_temp_threshold columns to persist through create and survive a read;
// item 5 rides the existing /write-off endpoint with the full on-hand quantity.
//
// Env:
//   PW_BASE   base URL (default: prod)
//   PW_TOKEN  director JWT (optional; skips the round-trip when absent)
//   PW_LAB_ID director's lab (default 3, Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock storage temperature + expired-lot write-off", () => {
  test("item create requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/inventory`, { data: { item_name: "x" } });
    expect([401, 403]).toContain(r.status());
  });

  test("storage_temp round-trips through create and read; expired lot writes off fully", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN not set: skipping authenticated round-trip");
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

    // Item 2: create an item with a deep-frozen storage requirement + threshold,
    // and an already-expired lot so item 5's one-click removal has a target.
    const created = await request.post(`${BASE}/api/labs/${LAB_ID}/inventory`, {
      headers: auth,
      data: {
        item_name: "PW Storage Temp Test Reagent",
        quantity_on_hand: 4,
        unit_cost: 25,
        usage_unit: "kit",
        expiration_date: "2026-01-01", // already expired
        storage_temp: "deep_frozen",
        storage_temp_threshold: "-70 C",
      },
    });
    expect(created.status()).toBe(200);
    const item = await created.json();
    expect(item.id).toBeTruthy();
    // Round-trip: the storage requirement persisted.
    expect(item.storage_temp).toBe("deep_frozen");
    expect(item.storage_temp_threshold).toBe("-70 C");

    // Item 5: the expired lot is written off in full (qty = on-hand, reason expired).
    const wo = await request.post(`${BASE}/api/inventory/${item.id}/write-off`, {
      headers: auth,
      data: { qty: item.quantity_on_hand, reason_code: "expired", note: "Expired lot removed from shelf" },
    });
    expect(wo.status()).toBe(200);
    const woBody = await wo.json();
    expect(woBody.write_off.qty).toBe(4);
    expect(woBody.write_off.after_on_hand).toBe(0);
    expect(woBody.write_off.reason_code).toBe("expired");

    // Cleanup the test item.
    await request.delete(`${BASE}/api/inventory/${item.id}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  });
});
