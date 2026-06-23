// tests/playwright/veritastock-duplicate-order-warning.spec.ts
//
// Gate 3 step 8 evidence for the duplicate-order warning (John, San Carlos
// 2026-06-23 demo feedback item 3): when the director places an order by any
// method and an item on that order already has an open PO (on_order_qty > 0),
// the system warns before generating, to reduce duplicate orders.
//
// The warning is a window.confirm() raised client-side. This spec drives the
// two page-level order methods (Order PDF and Snap Order) and asserts the
// confirm fires with the expected text. It DISMISSES (Cancel) the dialog, so
// no order document is generated and no inventory is mutated by the click.
//
// Setup mutates ONE item into the trigger state (on hand 0, on order 1) and
// restores it in afterAll, so the run is side-effect-free on the account.
//
// Run (Michael, with a real owner token -- the agent cannot mint a JWT):
//   1. Log into the VeritaStock host, copy localStorage "veritas_token".
//   2. $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//        npx playwright test veritastock-duplicate-order-warning
//
// Without PW_TOKEN the spec skips cleanly (CI compile-only gate still typechecks it).

import { test, expect, APIRequestContext } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritastock.com";
const TOKEN = process.env.PW_TOKEN || "";

// Resolved in beforeAll: the lab we mutate an item in, and the item we use.
let labId = 0;
let stockPath = "/veritastock";
let target: any = null;
let original: { quantity_on_hand: number; on_order_qty: number; on_order_placed_date: string | null } | null = null;

const auth = { Authorization: `Bearer ${TOKEN}` };

async function firstLabId(request: APIRequestContext): Promise<number> {
  const r = await request.get(`${BASE}/api/labs/me`, { headers: auth });
  if (!r.ok()) return 0;
  const labs = (await r.json()) as Array<{ labId: number }>;
  return labs.length ? labs[0].labId : 0;
}

async function getInventory(request: APIRequestContext): Promise<any[]> {
  const url = labId ? `${BASE}/api/labs/${labId}/inventory` : `${BASE}/api/inventory`;
  const r = await request.get(url, { headers: auth });
  return r.ok() ? ((await r.json()) as any[]) : [];
}

// Round-trip the full item back through the PUT (it is a full-object update),
// changing only the fields we need so nothing else on the item is disturbed.
async function putItem(request: APIRequestContext, item: any, overrides: Record<string, any>) {
  await request.put(`${BASE}/api/inventory/${item.id}`, {
    headers: { ...auth, "Content-Type": "application/json" },
    data: { ...item, ...overrides },
  });
}

test.describe.configure({ mode: "serial" });

test.describe("VeritaStock duplicate-order warning (item 3)", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test.beforeAll(async ({ request }) => {
    labId = await firstLabId(request);
    stockPath = labId ? `/labs/${labId}/veritastock` : "/veritastock";
    const items = await getInventory(request);
    // Need an item that can fall below its reorder point: burn_rate > 0.
    target = items.find((i) => (i.burn_rate || 0) > 0) || items[0] || null;
    if (!target) return;
    original = {
      quantity_on_hand: target.quantity_on_hand,
      on_order_qty: target.on_order_qty ?? 0,
      on_order_placed_date: target.on_order_placed_date ?? null,
    };
    // Drive it into the trigger state: nothing on the shelf, 1 unit on an open
    // PO. With burn_rate > 0 the reorder point is positive, so on hand 0 +
    // on order 1 still sits at/below it -> needs_reorder AND on_order_qty > 0.
    await putItem(request, target, {
      quantity_on_hand: 0,
      on_order_qty: 1,
      on_order_placed_date: "2026-06-01",
    });
  });

  test.afterAll(async ({ request }) => {
    if (target && original) {
      await putItem(request, target, original);
    }
  });

  test.beforeEach(async ({ page }) => {
    await injectAuth(page, BASE, TOKEN);
  });

  test("Order PDF warns when an item on the list already has an open order", async ({ page }) => {
    test.skip(!target, "no inventory item available to set up the trigger state");

    // Confirm the server now flags the target as both needs_reorder and on-order.
    const reGet = await page.evaluate(
      async ([b, t, lid, id]) => {
        const url = lid ? `${b}/api/labs/${lid}/inventory` : `${b}/api/inventory`;
        const r = await fetch(url, { headers: { Authorization: `Bearer ${t}` } });
        const items = r.ok ? await r.json() : [];
        return (items as any[]).find((i) => i.id === id) || null;
      },
      [BASE, TOKEN, labId, target.id] as const,
    );
    test.skip(!reGet || !reGet.needs_reorder || (reGet.on_order_qty || 0) <= 0,
      "target item did not reach the needs_reorder + on-order trigger state");

    let dialogMsg = "";
    page.on("dialog", async (d) => {
      dialogMsg = d.message();
      await d.dismiss(); // Cancel -> no PDF generated, no side effects.
    });

    await page.goto(`${BASE}${stockPath}`);
    const orderBtn = page.getByTestId("generate-order-pdf-button");
    await expect(orderBtn).toBeVisible({ timeout: 20000 });
    await orderBtn.click();

    await expect.poll(() => dialogMsg, { timeout: 10000 }).toContain("open order");
  });

  test("Snap Order warns when a selected item already has an open order", async ({ page }) => {
    test.skip(!target, "no inventory item available to set up the trigger state");

    let dialogMsg = "";
    page.on("dialog", async (d) => {
      dialogMsg = d.message();
      await d.dismiss();
    });

    const snapPath = labId ? `/labs/${labId}/veritastock/snap-order` : "/veritastock/snap-order";
    await page.goto(`${BASE}${snapPath}`);

    // Enter an order qty for the on-order item, then trigger the snap PDF.
    const qtyInput = page.getByTestId(`snap-qty-${target.id}`);
    await expect(qtyInput).toBeVisible({ timeout: 20000 });
    await qtyInput.fill("1");

    const snapBtn = page.getByTestId("generate-snap-order-button");
    await expect(snapBtn).toBeEnabled();
    await snapBtn.click();

    await expect.poll(() => dialogMsg, { timeout: 10000 }).toContain("open order");
  });
});
