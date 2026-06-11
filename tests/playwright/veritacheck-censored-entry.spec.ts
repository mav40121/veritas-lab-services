// tests/playwright/veritacheck-censored-entry.spec.ts
//
// Gate 3 step 8 receipt for Censored Data Entry (PR B, 2026-06-10).
// Drives the actual browser: opens a new VeritaCheck Method Comparison
// study, types a censored result ("<17" / ">500") into the data grid,
// and asserts the marker round-trips in the input (the browser blocks
// "<" on type="number" inputs, so this is exactly the bug class a
// server-side verify script cannot catch).
//
// Skips unless creds are provided so it is safe in any runner:
//   PW_TOKEN  — a logged-in veritas_token
//   PW_LAB_ID — a lab the user is an active member of (e.g. San Carlos = 2)
//   PW_BASE   — defaults to https://www.veritaslabservices.com
//
// Run: PW_TOKEN=... PW_LAB_ID=2 npx playwright test veritacheck-censored-entry

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

async function auth(page: any) {
  await page.goto(`${BASE}/`);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}

test.describe("VeritaCheck censored data entry", () => {
  test("Method Comparison grid accepts and echoes a censored value", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await auth(page);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`);

    // Logged in -> the study form (not the marketing hero) renders.
    const typeSelect = page.getByTestId("select-study-type");
    await expect(typeSelect).toBeVisible({ timeout: 15000 });

    // Pick Method Comparison from the shadcn Select.
    await typeSelect.click();
    await page.getByRole("option", { name: /Method Comparison/i }).click();

    // The data grid renders. Type a below-detection-limit result into the
    // first comparison-instrument cell of row 0 and a >ULOQ into the
    // reference (expected) cell. Both are type="text" now.
    const compCell = page.getByTestId("input-dp-value-0-1");
    await expect(compCell).toBeVisible({ timeout: 10000 });
    await compCell.fill("<17");
    await expect(compCell).toHaveValue("<17");

    const expectedCell = page.getByTestId("input-dp-expected-0");
    await expectedCell.fill(">500");
    await expect(expectedCell).toHaveValue(">500");

    // A plain number in another cell still behaves normally.
    const compCell2 = page.getByTestId("input-dp-value-1-1");
    await compCell2.fill("24");
    await expect(compCell2).toHaveValue("24");
  });
});
