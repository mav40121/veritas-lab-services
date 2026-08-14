// tests/playwright/veritaqc-md-cosign.spec.ts
//
// Gate 3 step 8 for the VeritaQC two-signature monthly review (MedStar,
// 2026-08-14). Per-lab opt-in: after the reviewer/technical consultant files
// the attestation, the designated Medical Director co-signs, and both
// signature blocks print on the monthly PDF.
//
//   1. Always-on API guards: the md-cosign-setting and md-cosign endpoints
//      reject unauthenticated callers.
//   2. PW_TOKEN-gated UI: the Monthly Review card exposes the co-signature toggle.
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 2 = San Carlos).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaQC MD co-signature", () => {
  test("md-cosign-setting endpoint requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/qc/md-cosign-setting`, { data: { required: true } });
    expect([401, 403]).toContain(r.status());
  });

  test("md-cosign endpoint requires auth", async ({ request }) => {
    const r = await request.post(`${BASE}/api/labs/${LAB_ID}/qc/period-reviews/md-cosign`, {
      data: { control_lot_id: 1, period_year: 2026, period_month: 8 },
    });
    expect([401, 403]).toContain(r.status());
  });

  test("Monthly Review card exposes the co-signature toggle", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-daily-review`);
    await expect(page.getByText(/Medical Director co-signature/i).first()).toBeVisible({ timeout: 15000 });
  });
});
