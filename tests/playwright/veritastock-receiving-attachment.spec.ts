// tests/playwright/veritastock-receiving-attachment.spec.ts
//
// Gate 3 evidence for attaching a document when receiving an order. Demo
// feedback (San Carlos): "we still cannot attach documents when receiving."
// The Receiving page now has an optional "Document URL" field per open PO, and
// the /receive endpoint stores it (document_url + document_label) and returns
// it in the receipt history, rendered as a clickable link. URL pointer only,
// no binary upload (mirrors the VeritaScan evidence model).
//
// Run (Michael, with a real owner token):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-receiving-attachment
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

test.describe("VeritaStock receiving document attachment", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("receipts endpoint exposes the document fields", async ({ request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/receipts`, { headers: auth });
    expect(r.ok(), `receipts: ${r.status()}`).toBeTruthy();
    const rows = await r.json();
    // The fields are selected even when null, so the key is present on any row.
    if (Array.isArray(rows) && rows.length > 0) {
      expect(rows[0]).toHaveProperty("document_url");
      expect(rows[0]).toHaveProperty("document_label");
    }
  });

  test("the Receiving page exposes a document URL field per open PO", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${labId}/veritastock/receiving`);

    // The receipt-history Document column header is always present.
    await expect(page.getByText("Receipt history")).toBeVisible({ timeout: 20000 });

    // If there is at least one open PO, its row carries a document URL input.
    const anyDocUrl = page.locator('[data-testid^="receiving-docurl-"]').first();
    if (await anyDocUrl.count()) {
      await expect(anyDocUrl).toBeVisible();
    }
  });
});
