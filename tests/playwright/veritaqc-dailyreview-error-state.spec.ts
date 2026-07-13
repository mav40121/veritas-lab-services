// tests/playwright/veritaqc-dailyreview-error-state.spec.ts
//
// Gate 3 step-8 evidence for the VeritaQC Daily Review error-as-empty fix (audit
// #2). The page used to render a green "all clear" checkmark (0 rejections) on a
// FAILED /qc/recent load, telling a director QC is in control when it never
// loaded. This forces the endpoint to 500 and asserts the distinct
// "Couldn't load QC results" error card with a Retry, not the green empty state.
// Needs PW_TOKEN; skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaQC Daily Review error state", () => {
  test("a 500 on /qc/recent shows the error card, not a green all-clear", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    await page.route("**/qc/recent**", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/veritaqc-app/review`, { waitUntil: "networkidle" });

    await expect(page.getByText(/Couldn't load QC results/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
    await expect(page.getByText(/No results match these filters/i)).toHaveCount(0);
  });
});
