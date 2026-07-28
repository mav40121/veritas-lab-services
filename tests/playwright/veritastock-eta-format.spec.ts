// tests/playwright/veritastock-eta-format.spec.ts
//
// Gate 3 receipt for the on-order ETA date formatting (VeritaStockPage grid).
// Demo seeds write a full ISO timestamp to on_order_expected_date; the grid used
// to render it raw ("ETA 2026-08-09T01:19:12.752Z"). It now slices to date-only.
// Drives the live single-site demo and asserts no raw timestamp leaks into an
// ETA label.
//
//   PW_BASE=... PW_TOKEN=<jwt> PW_LAB=2 npx playwright test veritastock-eta-format
//
// Skips (compile-only in CI) when PW_BASE/PW_TOKEN are not provided.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB || "2";
const ready = () => !!(BASE && TOKEN);

test.describe("VeritaStock on-order ETA formatting", () => {
  test("ETA renders as a plain date, never a raw ISO timestamp", async ({ page }) => {
    test.skip(!ready(), "needs PW_BASE/PW_TOKEN");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    const body = await page.evaluate(() => document.body.innerText);
    // No "ETA <date>T..:..:..Z" timestamp anywhere in the grid.
    expect(body).not.toMatch(/ETA\s*\d{4}-\d{2}-\d{2}T/);
  });
});
