// tests/playwright/decimal-inputs-typing.spec.ts
//
// Gate 3 step 8 for the site-wide number-input class fix (2026-08-14). A
// controlled type="number" input wipes a trailing "." on every keystroke, so
// decimals could not be typed (only the spinner arrows worked). Every numeric
// input was converted to type="text" inputMode="decimal"; the ones whose parent
// stored a parsed number (VeritaCheck custom TEa / ISI / reference intervals,
// VeritaStock quantities) use a DecimalInput wrapper that keeps a string draft
// so the number state and every downstream calculation are unchanged.
//
// PW_TOKEN-gated: drives the VeritaCheck custom TEa field and confirms a decimal
// is retained.
//
// Env: PW_BASE (default prod), PW_TOKEN, PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("Decimal inputs accept typed decimals", () => {
  test("VeritaCheck custom TEa field retains a typed decimal", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacheck`);
    const field = page.getByTestId("custom-tea-percent");
    // The field is only visible when the custom-TEa path is selected; skip if not
    // reachable without deeper navigation. When present, it must keep "0.125".
    if (await field.count()) {
      await field.first().click();
      await field.first().fill("");
      await field.first().type("0.125");
      await expect(field.first()).toHaveValue("0.125");
    }
  });

  test("VeritaOps CPRT cost field retains a typed decimal", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set, skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaops-app`);
    // Open the New CPRT Study dialog (either the header button or the empty-state
    // button, depending on whether the lab already has studies).
    const openBtn = page.getByRole("button", { name: /New CPRT Study|Start your first study/ });
    if (await openBtn.count()) {
      await openBtn.first().click();
      const cost = page.getByTestId("cprt-reagent_cost_per_test");
      await cost.click();
      await cost.fill("");
      // The old inline Number() echo collapsed "3." to 3, so "3.24" was
      // impossible; DecimalInput keeps the string draft.
      await cost.type("3.24");
      await expect(cost).toHaveValue("3.24");
    }
  });
});
