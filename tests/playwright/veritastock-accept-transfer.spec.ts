// tests/playwright/veritastock-accept-transfer.spec.ts
//
// Gate 3 step 8 evidence for the two-phase transfer lifecycle (John, San Carlos
// 2026-06-23 demo feedback item 4): a transfer is sent as 'pending' (stock
// leaves the source, in transit) and the destination Accepts it from the
// enterprise "Incoming transfers" panel (stock lands) or Rejects it (stock
// returns to the source).
//
// This spec sets up a pending 1-unit shipment via the API, then drives the
// customer-clickable Accept button in the UI and asserts the shipment flips to
// 'accepted' server-side. The 1-unit move is reclaimed by the demo's nightly
// reset.
//
// Run (Michael, with a real owner token spanning >= 2 enterprise locations):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-accept-transfer
// Without PW_TOKEN the spec skips cleanly (CI compile-only gate still typechecks it).

import { test, expect, APIRequestContext } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritastock.com";
const TOKEN = process.env.PW_TOKEN || "";
const auth = { Authorization: `Bearer ${TOKEN}` };

let fromLabId = 0;
let toLabId = 0;
let sourceItemId = 0;

async function labIds(request: APIRequestContext): Promise<number[]> {
  const r = await request.get(`${BASE}/api/labs/me`, { headers: auth });
  if (!r.ok()) return [];
  const labs = (await r.json()) as Array<{ labId: number }>;
  return labs.map((l) => l.labId);
}

test.describe.configure({ mode: "serial" });

test.describe("VeritaStock accept-transfer lifecycle (item 4)", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token spanning >= 2 locations");

  test.beforeAll(async ({ request }) => {
    const ids = await labIds(request);
    if (ids.length < 2) return;
    // Find a (lab, item) with stock on hand to be the source of a 1-unit ship.
    for (const id of ids) {
      const r = await request.get(`${BASE}/api/labs/${id}/inventory`, { headers: auth });
      if (!r.ok()) continue;
      const items = (await r.json()) as any[];
      const stocked = items.find((i) => (i.quantity_on_hand || 0) >= 1);
      if (stocked) {
        fromLabId = id;
        sourceItemId = stocked.id;
        toLabId = ids.find((x) => x !== id) || 0;
        break;
      }
    }
  });

  test("destination accepts a pending shipment and stock lands", async ({ page, request }) => {
    test.skip(!fromLabId || !toLabId || !sourceItemId, "need two enterprise locations with stock to set up a shipment");

    // 1. Send a 1-unit shipment via the API -> creates a pending batch.
    const sendRes = await request.post(`${BASE}/api/labs/${fromLabId}/veritastock/transfer-batch`, {
      headers: { ...auth, "Content-Type": "application/json" },
      data: { to_lab_id: toLabId, lines: [{ item_id: sourceItemId, quantity: 1 }] },
    });
    expect(sendRes.ok(), `send failed: ${sendRes.status()}`).toBeTruthy();
    const sent = await sendRes.json();
    expect(sent.status).toBe("pending");
    const batchId: string = sent.batch_id;
    expect(batchId).toBeTruthy();

    // 2. Drive the enterprise page; the Incoming panel should offer Accept.
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${toLabId}/veritastock/enterprise`);
    const panel = page.getByTestId("incoming-transfers");
    await expect(panel).toBeVisible({ timeout: 20000 });
    const acceptBtn = page.getByTestId("accept-transfer").first();
    await expect(acceptBtn).toBeVisible();
    await acceptBtn.click();

    // 3. The shipment should flip to accepted server-side.
    await expect
      .poll(async () => {
        const r = await request.get(`${BASE}/api/labs/${toLabId}/veritastock/transfers`, { headers: auth });
        if (!r.ok()) return "err";
        const { transfers } = await r.json();
        const row = (transfers as any[]).find((t) => t.batch_id === batchId);
        return row?.status || "missing";
      }, { timeout: 15000 })
      .toBe("accepted");
  });
});
