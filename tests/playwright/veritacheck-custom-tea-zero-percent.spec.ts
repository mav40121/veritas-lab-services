// tests/playwright/veritacheck-custom-tea-zero-percent.spec.ts
//
// Gate 3 step 8 for the 2026-08-26 "custom TEa shows ±0.0%" fix. A lab-defined
// TEa can set a 0% percent goal with only an absolute floor, e.g. ESR at ±3 mm/hr
// (an unregulated analyte with no CLIA-defined TEa). The Active-TEa summary used
// to read "±0.0% or ±3 mm/hr (greater)"; it must now read "±3 mm/hr".
//
// PW_TOKEN-gated. Drives the VeritaCheck custom-TEa block and asserts the
// Active-TEa summary drops the zero percent term. Degrades gracefully (like the
// decimal-inputs spec) if the block is not reachable without deeper study setup.
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaCheck custom TEa with a 0% percent goal", () => {
  test("Active TEa drops the zero percent term for an absolute-only goal", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck`);

    // Enter the custom-TEa path. The checkbox is only present once the TEa card
    // is visible; skip gracefully if it is not reachable without deeper setup.
    const useCustom = page.locator("#use-custom-tea");
    if (!(await useCustom.count())) {
      test.skip(true, "custom-TEa block not reachable without deeper study setup");
    }
    await useCustom.first().click();

    const pct = page.getByTestId("custom-tea-percent").first();
    const floor = page.getByTestId("custom-tea-abs-floor").first();
    const unit = page.getByTestId("custom-tea-abs-unit").first();
    await pct.click(); await pct.fill(""); await pct.type("0");
    await floor.click(); await floor.fill(""); await floor.type("3");
    await unit.click(); await unit.fill(""); await unit.type("mm/hr");

    // The Active-TEa summary must render the absolute floor only, never "0.0%".
    const active = page.locator("p", { hasText: "Active TEa:" }).first();
    await expect(active).toContainText("3 mm/hr");
    await expect(active).not.toContainText("0.0%");
  });
});
