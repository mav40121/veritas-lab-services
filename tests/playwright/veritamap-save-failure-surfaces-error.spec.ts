// tests/playwright/veritamap-save-failure-surfaces-error.spec.ts
//
// Gate 3 step 8 evidence for the VeritaMap silent-save fix (scorecard HIGH,
// 2026-07-10). VeritaMap map detail is auth-gated, so this is compile-only in CI
// and runs live only when PW_TOKEN + PW_MAP_URL point at a map with at least one
// test. It route-mocks the analyte-values PUT to 500, types a critical value,
// waits past the autosave debounce, and asserts the failure is surfaced (error
// state / destructive toast) and NO false "Saved" indicator appears.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const MAP_URL = process.env.PW_MAP_URL || ""; // e.g. /veritamap/maps/123

test.describe("VeritaMap: a failed critical-value save is surfaced, never silently 'Saved'", () => {
  test("PUT 500 on analyte-values shows an error and does not show Saved", async ({ page }) => {
    if (!TOKEN || !MAP_URL) {
      test.skip(true, "PW_TOKEN + PW_MAP_URL not set (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    // Force every critical-value save to fail server-side.
    await page.route("**/analyte-values/**", (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced failure" }) });
      }
      return route.continue();
    });

    await page.goto(`${BASE}${MAP_URL}`, { waitUntil: "networkidle" });

    // Expand the first test row and type a critical-low value.
    await page.getByRole("button", { name: /Details|Expand|values/i }).first().click().catch(() => {});
    const critLow = page.getByPlaceholder(/critical low/i).first();
    await critLow.fill("3.0");

    // Autosave debounce is 1500ms; wait past it, then assert the failure is visible.
    await page.waitForTimeout(2200);

    const errorText = page.getByText(/not saved|Save failed/i);
    await expect(errorText.first()).toBeVisible();

    // Critically: the "Saved" confirmation must NOT appear on a failed save.
    await expect(page.getByText(/^Saved$/)).toHaveCount(0);
  });
});
