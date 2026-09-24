// tests/playwright/veritatrack-calendar-expand.spec.ts
//
// VeritaTrack calendar month cells must expand to reveal tasks hidden behind
// "+N more". Env-gated: needs PW_TOKEN (member of PW_LAB_ID with VeritaTrack)
// and a lab whose calendar has a month with more than 3 tasks.
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritatrack-calendar-expand

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID || "3";

test.describe("VeritaTrack calendar month expand", () => {
  test.beforeEach(() => test.skip(!TOKEN, "Set PW_TOKEN and PW_LAB_ID to run."));

  test("a crowded month expands to reveal the hidden tasks", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/labs/${LAB}/veritatrack-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await page.getByRole("button", { name: /Calendar/i }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    const more = page.getByText(/\+\d+ more/).first();
    await expect(more).toBeVisible();
    await more.click();
    await page.waitForTimeout(500);
    await expect(page.getByText("Show less").first()).toBeVisible();
    await ctx.close();
  });
});
