// tests/playwright/veritascan-item-evidence.spec.ts
//
// Authed smoke for per-item evidence linking on the VeritaScan scan page.
// Surfaces the already-shipped evidence model (lab_documents +
// document_checklist_links + the coverage rollup) on the checklist walk: each
// item shows its linked evidence as chips and, for writers, an add/remove
// affordance. No new store; the page reuses the existing endpoints.
//
// Env-gated: set PW_TOKEN (a writer bearer for PW_LAB_ID) and PW_SCAN_ID (a
// scan that belongs to that lab) to run against a deployed build.
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_SCAN_ID=123 npx playwright test veritascan-item-evidence

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const SCAN = process.env.PW_SCAN_ID;

test.describe("VeritaScan per-item evidence linking", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !SCAN, "Set PW_TOKEN, PW_LAB_ID, PW_SCAN_ID to run the authed evidence check.");
  });

  test("a writer sees the add-evidence affordance on checklist items", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/labs/${LAB}/veritascan-app/${SCAN}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    // At least one checklist item exposes the add-evidence affordance to a writer.
    const add = page.locator('[data-testid^="evidence-add-"]').first();
    await expect(add).toBeVisible();
    await ctx.close();
  });

  test("the evidence picker opens and offers the library plus a Library shortcut", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/labs/${LAB}/veritascan-app/${SCAN}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    await page.locator('[data-testid^="evidence-add-"]').first().click();
    await page.waitForTimeout(800);
    await expect(page.getByText("Link evidence to this item")).toBeVisible();
    await expect(page.getByPlaceholder("Search the evidence library")).toBeVisible();
    await expect(page.getByText("Add a new document in the Library")).toBeVisible();
    await ctx.close();
  });
});
