// tests/playwright/veritaqc-all-lots-pdf.spec.ts
//
// Gate 3 step 8 for the VeritaQC "Download all lots" combined monthly PDF
// (2026-08-14). One document merges every active control lot with results in
// the period, instead of clicking through each lot. Server merges per-lot PDFs
// with pdf-lib.
//
//   1. Always-on API guard: the pdf-all endpoint rejects unauthenticated callers.
//   2. PW_TOKEN-gated UI exercise: the Monthly Review card exposes a "Download
//      all lots" button.
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 2).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "2";

test.describe("VeritaQC all-lots combined PDF", () => {
  test("pdf-all endpoint requires auth", async ({ request }) => {
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/qc/period-reviews/pdf-all?year=2026&month=8`);
    expect([401, 403]).toContain(r.status());
  });

  test("Monthly Review card exposes Download all lots", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-daily-review`);
    await expect(page.getByRole("button", { name: /download all lots/i }).first()).toBeVisible({ timeout: 15000 });
  });
});
