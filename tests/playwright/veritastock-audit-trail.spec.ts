// tests/playwright/veritastock-audit-trail.spec.ts
//
// Gate 3 step 8 evidence for the VeritaStock Audit Trail tab: the new
// "Audit Trail" toolbar button opens a page that lists the enterprise's
// inventory actions (When / Who / Action / Detail / Location), read from
// /api/labs/:labId/veritastock/audit-log.
//
// Run (Michael, with a real owner token):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-audit-trail
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

test.describe("VeritaStock Audit Trail tab", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("the audit-log endpoint returns the expected shape", async ({ request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/audit-log?limit=50`, { headers: auth });
    expect(r.ok(), `audit-log: ${r.status()}`).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.entries)).toBeTruthy();
    expect(Array.isArray(body.actions)).toBeTruthy();
  });

  test("the Audit Trail button opens a page with the audit table", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");

    await injectAuth(page, BASE, TOKEN);

    // From the VeritaStock page, the toolbar button navigates to the audit tab.
    await page.goto(`${BASE}/labs/${labId}/veritastock`);
    const btn = page.getByTestId("audit-trail-button");
    await expect(btn).toBeVisible({ timeout: 20000 });
    await btn.click();

    await expect(page.getByTestId("audit-trail-page")).toBeVisible({ timeout: 20000 });
    await expect(page.getByTestId("audit-table")).toBeVisible();
  });
});
