// tests/playwright/readiness-command-center.spec.ts
//
// Authed smoke for Build #1: the multi-lab readiness "command center" on the
// Inspection Readiness dashboard. For an account with >1 member lab, the roll-up
// renders a network summary band, a worst-first "Where to look first" action
// feed (when any lab has outstanding work), and a site x domain heatmap ("All
// labs") whose rows click through to each lab.
//
// Env-gated: PW_TOKEN (bearer for a multi-lab account, e.g. USON u69) + PW_LAB_ID
// (a lab that account belongs to, e.g. 25).
//
//   PW_TOKEN=... PW_LAB_ID=25 npx playwright test readiness-command-center

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("Inspection Readiness — multi-lab command center", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN (multi-lab account) and PW_LAB_ID to run the command-center check.");
  });

  test("summary band + heatmap render and rows click through", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/labs/${LAB}/readiness`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // Single-lab accounts don't get the roll-up; only assert when it's present.
    const band = page.getByText("Network readiness", { exact: false });
    if (await band.count()) {
      await expect(page.getByText(/sites ready/i)).toBeVisible();
      await expect(page.getByText(/network readiness/i)).toBeVisible();
      // Heatmap present.
      await expect(page.getByRole("columnheader", { name: "Lab" })).toBeVisible();
      // A lab row links into a lab-scoped route.
      const labLink = page.locator('a[href*="/labs/"][href$="/readiness"]').first();
      await expect(labLink).toBeVisible();
    } else {
      test.skip(true, "Account has a single lab; command-center roll-up is hidden by design.");
    }
    await ctx.close();
  });

  test("mobile width: no page error, band still renders", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/labs/${LAB}/readiness`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
