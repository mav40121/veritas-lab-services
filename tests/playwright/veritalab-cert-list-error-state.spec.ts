// tests/playwright/veritalab-cert-list-error-state.spec.ts
//
// Gate 3 step-8 evidence for the VeritaLab cert-list error-state fix (audit #2).
// The certificate roster used to render the "No certificates yet" empty state on
// a FAILED fetch, so a broken endpoint looked identical to "this lab has no
// certificates" -- a director with certs could re-add duplicates. This forces
// the certificates endpoint to 500 via route interception and asserts the page
// shows the distinct "Couldn't load certificates" error card instead of the
// empty state.
//
// Needs PW_TOKEN for a user with VeritaLab access; skips otherwise (compile-only
// in CI).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaLab cert-list error state", () => {
  test("a 500 on the certificates endpoint shows the error card, not 'No certificates yet'", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Force BOTH the lab-scoped and legacy certificate-list endpoints to 500,
    // regardless of which the active-lab state selects.
    await page.route("**/veritalab/certificates", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/veritalab-app`, { waitUntil: "networkidle" });

    // The distinct error card must appear...
    await expect(page.getByText(/Couldn't load certificates/i)).toBeVisible({ timeout: 10000 });
    // ...and the empty-state copy must NOT (it would be the pre-fix bug).
    await expect(page.getByText(/No certificates yet/i)).toHaveCount(0);
  });
});
