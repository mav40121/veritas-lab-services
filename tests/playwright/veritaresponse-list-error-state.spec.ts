// tests/playwright/veritaresponse-list-error-state.spec.ts
//
// Gate 3 step-8 evidence for the VeritaResponse error-as-empty fix (audit #2).
// The deficiency-response list used to render "No findings yet" on a FAILED
// findings load, so a broken/403 endpoint looked identical to zero open
// deficiencies (with 0 Overdue tiles) for a deadline tracker. This forces the
// findings endpoint to 500 and asserts the page shows the distinct "Couldn't
// load your findings" error card with a Retry, not the empty state.
// Needs PW_TOKEN; skips otherwise (compile-only in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaResponse list error state", () => {
  test("a 500 on the findings endpoint shows the error card, not 'No findings yet'", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    // Force every findings list read (legacy + lab-scoped) to fail.
    await page.route("**/api/findings", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );
    await page.route("**/api/labs/*/findings", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/veritaresponse`, { waitUntil: "networkidle" });

    await expect(page.getByText(/Couldn't load your findings/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/No findings yet/i)).toHaveCount(0);
  });
});
