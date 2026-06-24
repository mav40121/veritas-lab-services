// tests/playwright/veritastock-incoming-discoverability.spec.ts
//
// Gate 3 evidence for making the "accept incoming transfer" surface findable.
// Demo feedback (San Carlos): a transfer sent warehouse -> ED was hard to find
// on the ED side. The main VeritaStock page now carries an always-present
// "Incoming" toolbar button (data-testid="incoming-transfers-button") with a
// live count badge, plus a banner when a shipment is pending, both linking to
// the Enterprise view's Accept/Reject panel anchored at #incoming.
//
// Run (Michael, with a real owner token):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-incoming-discoverability
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

test.describe("VeritaStock incoming-transfer discoverability", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("the incoming endpoint returns the expected shape", async ({ request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/transfers/incoming`, { headers: auth });
    expect(r.ok(), `incoming: ${r.status()}`).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.incoming)).toBeTruthy();
  });

  test("the Incoming button is always present and links to the accept panel", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${labId}/veritastock`);

    // The button is present regardless of whether anything is pending, so users
    // learn where Accept/Reject lives.
    const btn = page.getByTestId("incoming-transfers-button");
    await expect(btn).toBeVisible({ timeout: 20000 });

    // Following it lands on the Enterprise view (where Accept/Reject lives).
    await btn.click();
    await expect(page.getByTestId("enterprise-page")).toBeVisible({ timeout: 20000 });
    await expect(page).toHaveURL(/\/veritastock\/enterprise/);
  });
});
