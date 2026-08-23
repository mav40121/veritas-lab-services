// tests/playwright/veritamap-intelligence-panel.spec.ts
//
// Gate 3 step 8 (browser) evidence for the VeritaMap "Intelligence" panel fix.
// The panel used to hardcode "0 Tests Fully Compliant" and show the STATIC total
// requirement for correlations / cal verifications, so after studies stamped the
// grid green it still read "3 Correlations Required / 0 Fully Compliant" -- it
// disagreed with the grid. This drives the authenticated map page and asserts the
// panel now AGREES WITH THE GRID: a fully-covered map shows a non-zero
// "Tests Fully Compliant" and no outstanding correlations.
//
// Read-only, non-mutating. Needs PW_TOKEN; skips otherwise (compile-only gate run).
// Env: PW_BASE (default production www), PW_TOKEN, PW_MAP_LAB_ID (default 22,
// the Riverpoint tutorial sandbox), PW_MAP_ID (default 87).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_MAP_LAB_ID || "22";
const MAP_ID = process.env.PW_MAP_ID || "87";

test.describe("VeritaMap Intelligence panel agrees with the grid", () => {
  test("a fully-covered map shows non-zero Fully Compliant and no outstanding correlations", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritamap-app/${MAP_ID}`, { waitUntil: "networkidle" });

    // Wait for the map grid to hydrate.
    await expect(page.getByText("Glucose").first()).toBeVisible({ timeout: 25000 });

    const body = (await page.textContent("body")) || "";

    // Core regression guard: the panel must not report "0 Tests Fully Compliant"
    // on a map the grid reports as compliant. On the sandbox (100%, no critical
    // gaps) at least one test is fully compliant.
    expect(body).not.toContain("0 Tests Fully Compliant");

    // Worklist emptied: no outstanding correlations remain once studies are on file.
    expect(body).toContain("No correlations required");
  });
});
