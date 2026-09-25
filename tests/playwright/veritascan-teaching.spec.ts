// tests/playwright/veritascan-teaching.spec.ts
//
// Authed browser smoke for Build #7 (VeritaScan teaching mode). On a scan, a
// writer can flag it as a teaching example, which reveals the Teaching example
// badge and the Teaching View toggle; entering Teaching View shows the Learning
// objectives editor and per-item teaching-note authoring. This drives the real
// clickable flow (Gate 3 step 8) and restores the scan's teaching flag to off
// at the end, so it leaves state as found.
//
// Env-gated: PW_TOKEN (writer on a VeritaScan-enabled lab), PW_LAB_ID, and
// PW_SCAN_ID for an existing scan in that lab. Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_SCAN_ID=NN npx playwright test veritascan-teaching

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const SCAN = process.env.PW_SCAN_ID;

test.describe("VeritaScan — teaching mode", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !SCAN, "Set PW_TOKEN, PW_LAB_ID and PW_SCAN_ID to run the VeritaScan teaching check.");
  });

  test("flag a scan as teaching, enter Teaching View, restore", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritascan-app/${SCAN}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // If it's already flagged (from a prior run), remove first so we exercise
    // the "mark" path cleanly.
    const removeFirst = page.getByRole("button", { name: /Remove teaching flag/i });
    if (await removeFirst.count()) {
      await removeFirst.first().click();
      await page.waitForTimeout(1500);
    }

    // Mark as teaching example.
    await page.getByRole("button", { name: /Mark as teaching example/i }).first().click();
    await page.waitForTimeout(1800);

    // Badge + Teaching View toggle appear.
    await expect(page.getByText("Teaching example", { exact: true }).first()).toBeVisible();
    const viewToggle = page.getByRole("button", { name: /^Teaching View$/ });
    await expect(viewToggle.first()).toBeVisible();

    // Enter Teaching View; the Learning objectives editor renders.
    await viewToggle.first().click();
    await page.waitForTimeout(800);
    await expect(page.getByText("Learning objectives", { exact: true }).first()).toBeVisible();

    // Restore: back to Edit scan, then remove the teaching flag.
    await page.getByRole("button", { name: /^Edit scan$/ }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: /Remove teaching flag/i }).first().click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("button", { name: /Mark as teaching example/i }).first()).toBeVisible();

    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
