// tests/playwright/veritabench-staffing-hardening.spec.ts
//
// Gate 3 step 8 (browser) evidence for the VeritaShift/Staffing page-hardening batch.
//
//   #3/#20  a failed load of the staffing studies rendered "No staffing studies yet"
//           (identical to a genuinely empty workspace). A failed load now shows a
//           distinct error card with Retry and never the empty state.
//
// The whole page is auth-gated, so this needs PW_TOKEN (a VeritaAssure-plan user).
// It mocks a 500 on the studies/grid endpoints and asserts the error state; it
// skips without a token (compile-only gate run).
//
// Env: PW_BASE (default production www), PW_TOKEN.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaShift staffing page hardening", () => {
  test("a failed studies load reads as an error, not an empty workspace (#3/#20)", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.route("**/api/staffing-studies?*", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.route("**/api/staffing-studies", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.route("**/api/staffing-grid?*", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.route("**/api/staffing-grid", (r) => r.fulfill({ status: 500, body: "{}" }));

    await page.goto(`${BASE}/veritabench/staffing`, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("alert")).toContainText(/couldn't load staffing studies/i, { timeout: 15000 });
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("no staffing studies yet");
  });
});
