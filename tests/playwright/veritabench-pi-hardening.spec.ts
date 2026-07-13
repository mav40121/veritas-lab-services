// tests/playwright/veritabench-pi-hardening.spec.ts
//
// Gate 3 step 8 (browser) evidence for the VeritaQA/PI page-hardening batch.
//
//   #3  a failed load of the PI departments rendered the "Set Up Your PI Program"
//       first-time wizard (as if the account were brand new). A failed load now
//       shows a distinct error view with Retry and never the setup wizard.
//
// The whole page is auth-gated, so this needs PW_TOKEN (a VeritaAssure-plan user).
// It mocks a 500 on the PI departments endpoint and asserts the error state; it
// skips without a token (compile-only gate run).
//
// Env: PW_BASE (default production www), PW_TOKEN.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaQA PI page hardening", () => {
  test("a failed departments load reads as an error, not a new account (#3)", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.route("**/api/pi/departments", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.route("**/api/pi/departments?*", (r) => r.fulfill({ status: 500, body: "{}" }));

    await page.goto(`${BASE}/veritabench/pi`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("alert")).toContainText(/couldn't load your pi program/i, { timeout: 15000 });
    // The setup wizard must NOT appear on a load error.
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("set up your pi program");
  });
});
