// tests/playwright/veritashift-adequacy.spec.ts
//
// Gate 3 receipt for Wave D3 (2026-06-12): the VeritaShift staffing study
// Analysis tab exposes a "Staffing adequacy determination" panel where the
// director records the 493.1445(e)(5) adequacy determination.
//
// Needs creds: PW_TOKEN, PW_STUDY_ID (an existing staffing study). Skips
// cleanly without them.
//
// Run: PW_TOKEN=... PW_STUDY_ID=1 npx playwright test veritashift-adequacy

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const STUDY_ID = process.env.PW_STUDY_ID || "";

test.describe("VeritaShift staffing adequacy (Wave D3)", () => {
  test("analysis tab shows the staffing adequacy determination panel", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/veritabench/staffing`);
    // Open the first study (cards are clickable) then the Analysis tab.
    const firstCard = page.locator(".cursor-pointer").first();
    if (!(await firstCard.count())) test.skip(true, "no staffing study to open");
    await firstCard.click().catch(() => {});
    const analysisTab = page.getByRole("button", { name: /^Analysis$/ });
    if (await analysisTab.count()) await analysisTab.click();
    await expect(page.getByText(/Staffing adequacy determination/i)).toBeVisible({ timeout: 12000 });
    await expect(page.getByText(/493\.1445/i)).toBeVisible();
  });
});
