// tests/playwright/veritabench-page-hardening.spec.ts
//
// Gate 3 step 8 (browser) evidence for the VeritaBench/VeritaPace page-hardening batch.
//
//   #2/#12  the public landing over-claimed "peer" comparisons that do not exist and
//           described the ratio in the wrong direction ("tests per paid hour"). The tool
//           computes productive hours per billable test (lower is better) versus static
//           published reference ranges. The landing copy now says so.
//   #3/#20  a failed data load rendered the "No productivity data yet" empty state,
//           indistinguishable from a genuinely empty lab. A failed load now shows a
//           distinct error banner with Retry and never the empty state.
//
// The public-landing test runs credential-free (asserts the corrected marketing copy on
// the rendered page). The error-state test needs PW_TOKEN (a VeritaAssure-plan user) and
// mocks a 500 on /api/productivity; it skips without a token.
//
// Env: PW_BASE (default production www), PW_TOKEN.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaBench page hardening", () => {
  test("public landing states the honest metric and drops the peer-data claim (#2/#12)", async ({ page }) => {
    await page.goto(`${BASE}/veritabench`, { waitUntil: "domcontentloaded" });
    // The unauthenticated hero renders the product name.
    await expect(page.getByRole("heading", { name: /VeritaPace/i }).first()).toBeVisible({ timeout: 15000 });

    const body = (await page.locator("body").innerText()).toLowerCase();
    // Honest metric direction is present.
    expect(body).toContain("productive hours per billable test");
    // Fabricated live-peer-comparison language is gone.
    expect(body).not.toContain("peer labs");
    expect(body).not.toContain("peer benchmarking");
    expect(body).not.toContain("peer groups");
    // The inverted metric label is gone.
    expect(body).not.toContain("tests per paid hour");
  });

  test("a failed productivity load reads as an error, not an empty lab (#3/#20)", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    // Force the productivity data load to fail.
    await page.route("**/api/productivity?*", (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.route("**/api/productivity", (r) => r.fulfill({ status: 500, body: "{}" }));

    await page.goto(`${BASE}/veritabench`, { waitUntil: "domcontentloaded" });

    // The distinct error banner appears...
    await expect(page.getByRole("alert")).toContainText(/couldn't load productivity data/i, { timeout: 15000 });
    // ...and the misleading empty state does NOT.
    const body = (await page.locator("body").innerText()).toLowerCase();
    expect(body).not.toContain("no productivity data yet");
  });
});
