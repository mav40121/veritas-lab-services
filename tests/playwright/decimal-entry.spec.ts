// tests/playwright/decimal-entry.spec.ts
//
// Regression guard: a user must be able to type a decimal point into the
// VeritaCheck data-entry grid. The censoring grid (#716) bound the input value
// to the stored NUMBER, so typing "10." parsed to 10 and React reset the field,
// making a decimal impossible ("10.5" became "105"). Must be typed key-by-key
// (a one-shot fill hides the bug, since "10.5" is a complete number).
//
// Needs creds: PW_TOKEN + PW_LAB_ID (a lab with a CLIA the token can write to).
// Skips cleanly without them.
//
// Run: PW_TOKEN=... PW_LAB_ID=3 npx playwright test decimal-entry

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaCheck data entry: decimal point types through", () => {
  test("typing 10.5 key-by-key keeps the decimal; <17 censoring still works", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`, { waitUntil: "networkidle" });

    await page.getByTestId("select-study-type").click();
    await page.getByRole("option", { name: /Method Comparison/i }).click();
    await page.getByText("Data Entry", { exact: true }).click();

    const cell = page.getByTestId("input-dp-value-0-1");
    await expect(cell).toBeVisible({ timeout: 15000 });

    // Type the decimal one key at a time (this is what breaks under the bug).
    await cell.click();
    await cell.pressSequentially("10.5", { delay: 60 });
    await expect(cell).toHaveValue("10.5");

    // Censoring must still work (a "<17" cell).
    const cell2 = page.getByTestId("input-dp-value-1-1");
    await cell2.click();
    await cell2.pressSequentially("<17", { delay: 60 });
    await expect(cell2).toHaveValue("<17");
  });
});
