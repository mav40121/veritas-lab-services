// tests/playwright/nys-clep-phase0-jurisdiction.spec.ts
//
// Gate 3 step 8 evidence for NYS CLEP Phase-0 (2026-07-10). The jurisdiction card
// is on the auth-gated /account/settings page, so this is compile-only in CI and
// runs live with PW_TOKEN. It proves CLIA-safety: a default (CLIA) lab shows the
// "Laboratory Jurisdiction" card reading "CLIA (federal)" and NO "NYS DOH / CLEP"
// badge anywhere. A NYS-confirmed lab would show the badge (asserted on demand
// with PW_NYS_EXPECTED=1 once a lab is set to NYS-CLEP).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const NYS_EXPECTED = process.env.PW_NYS_EXPECTED === "1";

test.describe("NYS CLEP Phase-0: jurisdiction card + CLIA-safe badge", () => {
  test("account settings shows the jurisdiction card; CLIA lab shows no NYS badge", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "PW_TOKEN not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/account/settings`, { waitUntil: "networkidle" });

    await expect(page.getByText("Laboratory Jurisdiction")).toBeVisible();

    const body = await page.locator("body").innerText();
    if (NYS_EXPECTED) {
      expect(body).toContain("NYS DOH / CLEP");
    } else {
      // Default CLIA lab: current regime reads CLIA, no NYS jurisdiction badge.
      expect(body).toContain("CLIA (federal)");
      expect(body).not.toContain("NYS DOH / CLEP");
    }
  });
});
