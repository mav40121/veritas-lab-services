// tests/playwright/veritaqc-apppage-error-state.spec.ts
//
// Gate 3 step-8 evidence for the VeritaQC entry-page error-state fixes (audit #8
// / #3). A failed control-lot load used to render the "No control lots yet / Add
// your first control lot" onboarding state (inviting re-creation of existing
// lots). This forces /qc/lots to 500 and asserts the distinct "Couldn't load
// control lots" error card with Retry, not the onboarding empty state.
// Needs PW_TOKEN; skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaQC entry page error state", () => {
  test("a 500 on /qc/lots shows the error card, not the 'add your first lot' onboarding", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    await page.route("**/qc/lots", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/veritaqc-app`, { waitUntil: "networkidle" });

    await expect(page.getByText(/Couldn't load control lots/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
    await expect(page.getByText(/Add your first control lot/i)).toHaveCount(0);
  });
});
