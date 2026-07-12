// tests/playwright/veritaresponse-finding-error-state.spec.ts
//
// Gate 3 step-8 evidence for the VeritaResponse finding-detail error fix (audit
// #4). A transient 500 on the finding load used to render "This finding may have
// been deleted, or you do not have access to it" (false + alarming for an active
// finding). This forces the finding endpoint to 500 and asserts the distinct
// "Couldn't load this finding" card with a Retry, not the not-found copy.
// Needs PW_TOKEN; skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaResponse finding detail error state", () => {
  test("a 500 on the finding load shows the retry error card, not 'not found'", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    await page.route("**/api/findings/*", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/veritaresponse/1`, { waitUntil: "networkidle" });

    await expect(page.getByText(/Couldn't load this finding/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
    await expect(page.getByText(/may have been deleted/i)).toHaveCount(0);
  });
});
