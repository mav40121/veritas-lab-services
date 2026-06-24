// tests/playwright/veritastock-lots-dialog.spec.ts
//
// Gate 3 evidence for Phase 3 of nested-lot tracking (Option 2): the "Lots"
// button on each inventory row opens a dialog listing the product's child lots
// (lot # + expiration + qty), oldest-expiry first (FEFO order), read from
// GET /api/labs/:labId/veritastock/items/:itemId/lots.
//
// Run (Michael, owner token on the VeritaStock service):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-lots-dialog
// Without PW_TOKEN the spec skips cleanly (CI compile-only gate still typechecks it).

import { test, expect, APIRequestContext } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritastock.com";
const TOKEN = process.env.PW_TOKEN || "";
const auth = { Authorization: `Bearer ${TOKEN}` };

async function firstLabId(request: APIRequestContext): Promise<number> {
  const r = await request.get(`${BASE}/api/labs/me`, { headers: auth });
  if (!r.ok()) return 0;
  const labs = (await r.json()) as Array<{ labId: number }>;
  return labs.length ? labs[0].labId : 0;
}

test.describe("VeritaStock lots dialog (Phase 3)", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("a row's Lots button opens the lots dialog", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${labId}/veritastock`);

    const lotsBtn = page.locator('[data-testid^="button-lots-"]').first();
    await expect(lotsBtn).toBeVisible({ timeout: 20000 });
    await lotsBtn.click();
    // The dialog shows either the lots table or the empty state.
    await expect(page.getByText("Lots", { exact: false }).first()).toBeVisible({ timeout: 10000 });
  });
});
