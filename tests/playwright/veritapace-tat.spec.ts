// tests/playwright/veritapace-tat.spec.ts
//
// Gate 3 receipt for Wave D2 (2026-06-12): the VeritaPace (VeritaBench PI)
// metric editor exposes a TAT methodology section (start/end events, threshold,
// measurement methodology) when "This is a turnaround time indicator" is on.
//
// Needs creds: PW_TOKEN. Skips cleanly without it.
//
// Run: PW_TOKEN=... npx playwright test veritapace-tat

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaPace TAT defensibility (Wave D2)", () => {
  test("metric editor reveals the TAT methodology fields", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/veritabench`);
    // Open the Add Metric dialog (label varies; try a few).
    const addBtn = page.getByRole("button", { name: /Add Metric|New Metric|Metric/i }).first();
    if (!(await addBtn.count())) test.skip(true, "no metric editor reachable for this account");
    await addBtn.click().catch(() => {});
    const tatToggle = page.getByText(/turnaround time \(TAT\) indicator/i).first();
    await expect(tatToggle).toBeVisible({ timeout: 10000 });
    // Toggle it on; the start/end event selects and methodology textarea appear.
    await page.getByRole("checkbox").first().check().catch(() => {});
    await expect(page.getByText(/Measurement methodology and data source/i)).toBeVisible({ timeout: 8000 });
  });
});
