// tests/playwright/iqcp-builder-page.spec.ts
//
// Authed smoke for the IQCP Builder page (VeritaDC / veritapolicy-app/iqcp).
// Env-gated: set PW_TOKEN (a valid bearer for a member of PW_LAB_ID) and
// PW_LAB_ID to run against a deployed build. Verifies the page renders the
// builder shell and the 3-question pre-screen entry point.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test iqcp-builder-page

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("IQCP Builder page (VeritaDC)", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the authed IQCP page check.");
  });

  test("renders the builder shell and the start-new entry point", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/iqcp`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    const body = (await page.textContent("body")) || "";
    expect(body).toContain("IQCP Builder");
    expect(body).toContain("Start a new IQCP");
    await ctx.close();
  });

  test("the pre-screen shows all three gating questions", async ({ browser }) => {
    const ctx = await browser.newContext();
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/iqcp`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.getByText("Start a new IQCP").click();
    await page.waitForTimeout(1500);
    const body = (await page.textContent("body")) || "";
    expect(body).toContain("nonwaived");
    expect(body.toLowerCase()).toContain("less external qc");
    await ctx.close();
  });
});
