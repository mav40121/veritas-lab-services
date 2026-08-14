// tests/playwright/veritaqc-void-result.spec.ts
//
// Gate 3 step 8 for the VeritaQC soft-delete (void) feature (2026-08-14). A QC
// result logged on the wrong lot/level or mis-keyed can be voided with a
// required reason. The row stays for the audit trail (voided_at, voided_by,
// void_reason) but drops out of the chart, calculated stats, Westgard history,
// and the monthly review.
//
//   1. Always-on API guard: the void endpoint rejects unauthenticated callers.
//   2. PW_TOKEN-gated UI exercise: the Recent-results table exposes a Void
//      control. Skips cleanly without a token.
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 14).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "14";

test.describe("VeritaQC void result", () => {
  test("void endpoint requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/qc/results/1/void`, {
      data: { reason: "test" },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("Recent-results table exposes a Void control", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-app`);
    await expect(page.getByRole("button", { name: /^Void$/i }).first()).toBeVisible({ timeout: 15000 });
  });
});
