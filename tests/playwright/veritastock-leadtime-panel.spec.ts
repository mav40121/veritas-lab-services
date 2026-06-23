// tests/playwright/veritastock-leadtime-panel.spec.ts
//
// Gate 3 step 8 evidence for the lead-time discoverability fix: the "Lead-time
// check" panel on the Receiving page now ALWAYS renders (data-testid
// "leadtime-drift-panel"), showing either flag cards (when drift exists) or an
// empty state (data-testid "leadtime-empty") so a starred hero feature is never
// invisible.
//
// Run (Michael, with a real owner token):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-leadtime-panel
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

test.describe("VeritaStock Receiving: lead-time panel always visible", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("the Lead-time check panel renders with flags or an empty state", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved for this token");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${labId}/veritastock/receiving`);

    // The panel is always present now (was previously hidden when no drift).
    const panel = page.getByTestId("leadtime-drift-panel");
    await expect(panel).toBeVisible({ timeout: 20000 });

    // It shows either a drift flag card or the empty state, never nothing.
    const hasFlag = await page.getByTestId(/^leadtime-flag-/).first().isVisible().catch(() => false);
    const hasEmpty = await page.getByTestId("leadtime-empty").isVisible().catch(() => false);
    expect(hasFlag || hasEmpty, "panel must show a flag card or the empty state").toBeTruthy();
  });
});
