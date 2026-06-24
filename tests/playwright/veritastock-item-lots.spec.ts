// tests/playwright/veritastock-item-lots.spec.ts
//
// Gate 3 evidence for Phase 1 of nested-lot tracking (Option 2). A read-only
// GET /api/labs/:labId/veritastock/items/:itemId/lots returns the lots held under
// a product, oldest-expiry first, from the new inventory_lots table. Phase 1 is
// additive: the item's quantity_on_hand stays authoritative and should equal the
// lot total (in_sync == true) until Phase 2 makes mutations lot-based.
//
// Run (Michael, owner token on the VeritaStock service):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-item-lots
// Without PW_TOKEN the spec skips cleanly (CI compile-only gate still typechecks it).

import { test, expect, APIRequestContext } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritastock.com";
const TOKEN = process.env.PW_TOKEN || "";
const auth = { Authorization: `Bearer ${TOKEN}` };

async function firstLabId(request: APIRequestContext): Promise<number> {
  const r = await request.get(`${BASE}/api/labs/me`, { headers: auth });
  if (!r.ok()) return 0;
  const labs = (await r.json()) as Array<{ labId: number }>;
  return labs.length ? labs[0].labId : 0;
}

test.describe("VeritaStock item lots (Phase 1)", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("an item's lots mirror its quantity_on_hand (in_sync)", async ({ request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const inv = await request.get(`${BASE}/api/labs/${labId}/inventory`, { headers: auth });
    test.skip(!inv.ok(), "inventory not reachable");
    const items = (await inv.json()) as Array<{ id: number; quantity_on_hand: number }>;
    const stocked = items.find((i) => (i.quantity_on_hand || 0) > 0);
    test.skip(!stocked, "no stocked item to check");

    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/items/${stocked!.id}/lots`, { headers: auth });
    expect(r.ok(), `lots: ${r.status()}`).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.lots)).toBeTruthy();
    // Phase 1: the lot total equals quantity_on_hand.
    expect(body.in_sync, `lot_total ${body.lot_total} vs on_hand ${body.quantity_on_hand}`).toBeTruthy();
  });
});
