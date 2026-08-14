// tests/playwright/veritaqc-typeable-inputs.spec.ts
//
// Gate 3 step 8 for the VeritaQC usability pass (2026-08-14):
//   - QC numeric inputs converted from spinner type="number" to typeable
//     type="text" inputMode="decimal"/"numeric" fields (the Result value and
//     Points fields could only be changed with the arrows, not typed).
//   - Levey-Jennings chart gained a labeled footer: programmed manufacturer
//     mean/SD on the left, calculated mean/SD of the plotted points on the right.
//   - Each result's run-note comment is surfaced in a Recent-results "Notes"
//     column and on point hover.
//
// PW_TOKEN-gated UI exercise (skips cleanly in the reporting-only smoke run so
// it does not fail before deploy). The typing itself is the human-in-the-loop
// receipt on prod, since the in-app browser is walled off from the domain.
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 14).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "14";

test.describe("VeritaQC typeable inputs + chart stats", () => {
  test("Result value field is a typeable decimal field (not a spinner)", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-app`);

    const valueField = page.getByLabel(/result value/i).first();
    await expect(valueField).toBeVisible({ timeout: 15000 });
    // Typeable: type a decimal and confirm the field holds exactly what was typed
    // (a coercing/clamping number input would not retain "1.07").
    await valueField.click();
    await valueField.fill("");
    await valueField.type("1.07");
    await expect(valueField).toHaveValue("1.07");
    await expect(valueField).toHaveAttribute("inputmode", "decimal");
  });

  test("Levey-Jennings footer shows programmed and calculated mean/SD", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-app`);
    await expect(page.getByText(/Programmed \(manufacturer\)/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Calculated \(n=/i).first()).toBeVisible();
  });
});
