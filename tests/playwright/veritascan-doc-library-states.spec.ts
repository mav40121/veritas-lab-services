// tests/playwright/veritascan-doc-library-states.spec.ts
//
// Gate 3 step 8 evidence for the VeritaScan Document Library loading/error states
// (scorecard #4, 2026-07-10). The library is auth-gated, so this is compile-only in
// CI and runs live only with PW_TOKEN + PW_DOC_LIBRARY_URL. It route-mocks the
// documents GET to 500 (asserts the error state, NOT a false "empty") and to []
// (asserts the true empty state), so a fetch failure is no longer indistinguishable
// from an empty library.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LIB_URL = process.env.PW_DOC_LIBRARY_URL || ""; // e.g. /labs/17/veritascan/documents

test.describe("VeritaScan Document Library distinguishes error from empty", () => {
  test("a 500 shows an error state, not a false 'no documents'", async ({ page }) => {
    if (!TOKEN || !LIB_URL) {
      test.skip(true, "PW_TOKEN + PW_DOC_LIBRARY_URL not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    await page.route("**/veritascan/documents**", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) });
      }
      return route.continue();
    });
    await page.goto(`${BASE}${LIB_URL}`, { waitUntil: "networkidle" });
    await expect(page.getByText(/Could not load documents/i)).toBeVisible();
    await expect(page.getByText(/No documents yet/i)).toHaveCount(0);
  });

  test("an empty result shows the true empty state", async ({ page }) => {
    if (!TOKEN || !LIB_URL) {
      test.skip(true, "PW_TOKEN + PW_DOC_LIBRARY_URL not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    await page.route("**/veritascan/documents**", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      return route.continue();
    });
    await page.goto(`${BASE}${LIB_URL}`, { waitUntil: "networkidle" });
    await expect(page.getByText(/No documents yet/i)).toBeVisible();
  });
});
