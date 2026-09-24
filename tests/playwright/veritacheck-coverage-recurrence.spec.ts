// tests/playwright/veritacheck-coverage-recurrence.spec.ts
//
// Authed smoke for the method-comparison recurrence on the VeritaCheck Coverage
// page. Method comparison / correlation is periodic (CLIA §493.1281, 6 months):
// a signed study banks the cycle and the requirement rolls to next-due = signed
// + 6 months, so the table shows a "Next due on" column and statuses
// Missing / Failed / Completed, unsigned instead of "done forever". Fixes the
// San Carlos case (103 signed correlations that never reset).
//
// Env-gated: set PW_TOKEN (a member of PW_LAB_ID) and PW_LAB_ID (a lab with a map).
//
//   PW_TOKEN=... PW_LAB_ID=2 npx playwright test veritacheck-coverage-recurrence

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("VeritaCheck Coverage method-comparison recurrence", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the authed coverage recurrence check.");
  });

  test("Coverage renders the Next due on column for method comparisons", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/labs/${LAB}/veritacheck/coverage`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    // The recurrence column header is present when a map exists.
    const body = (await page.textContent("body")) || "";
    if (body.includes("No VeritaMap yet")) {
      test.skip(true, "Lab has no map; coverage table not rendered.");
    }
    // Both the method-comparison and the Cal Ver / Linearity tables now carry a
    // recurrence "Next due on" column.
    const nextDueHeaders = page.getByRole("columnheader", { name: "Next due on" });
    await expect(nextDueHeaders.first()).toBeVisible();
    expect(await nextDueHeaders.count()).toBeGreaterThanOrEqual(1);
  });
});
