// tests/playwright/veritapace-leverage-report.spec.ts
//
// Phase 4 of the operations leverage chain: the VeritaPace "CFO report" button on
// the Forecast from Goal card generates the one-page Operations Leverage Report PDF
// (POST /api/productivity/leverage-report -> one-time token -> /api/pdf/:token, the
// same flow as the reorder PDF). It reuses the verified chain numbers; the report
// frames the gap as the staff-cut-vs-capital trade-off.
//
// Asserts the button renders on the forecast card. Requires PW_TOKEN (owner JWT) and
// skips otherwise so it stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaPace: leverage report (CFO PDF)", () => {
  test("CFO report button renders on the forecast card", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritabench`);
    await expect(page.locator("body")).toContainText("Forecast from Goal");
    await expect(page.getByRole("button", { name: /CFO report/i })).toBeVisible();
  });
});
