// tests/playwright/veritastock-intacct-gated.spec.ts
//
// The Sage Intacct export was a San-Carlos-specific build for the warehouse on the
// standalone veritastock.com deployment. It must NOT surface to general customers on
// the main suite app (veritaslabservices.com), where a prospect or lab customer would
// otherwise see a "Set up Sage Intacct" button for an integration they do not use.
//
// The buttons are gated to onStock = isStockHost(), false on the main app. This spec
// asserts the Sage Intacct UI is absent on the main-app VeritaStock page. Requires
// PW_TOKEN (owner JWT) and skips otherwise so it stays green in the compile-only gate.
//
// Env: PW_BASE (default production www = the main suite app), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaStock: Sage Intacct gated off the main app", () => {
  test("no Sage Intacct button on the main suite app", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    // Only meaningful on the main suite host; skip if pointed at veritastock.com.
    if (/veritastock\.com/i.test(BASE)) {
      test.skip(true, "PW_BASE is the standalone stock host; Sage is intended there.");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritastock`);
    await expect(page.locator("body")).toContainText("VeritaStock");
    await expect(page.locator("body")).not.toContainText("Sage Intacct");
  });
});
