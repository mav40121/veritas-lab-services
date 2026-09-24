// tests/playwright/veritacomp-competencies-owed.spec.ts
//
// Authed smoke for the #48 "Competencies owed" view on the VeritaComp landing
// page. Owed competencies are derived from each person's VeritaStaff instrument
// assignments (via the /competency/owed endpoint), on the CLIA timeline, with
// instruments not covered by any competency program flagged as gaps. The
// section renders only when the lab has VeritaStaff testing personnel, so this
// smoke asserts the page loads without a render crash and, when the section is
// present, that it expands and shows the derivation note.
//
// Env-gated: set PW_TOKEN (a bearer for a member of PW_LAB_ID) and PW_LAB_ID.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritacomp-competencies-owed

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("VeritaComp competencies owed (derived from VeritaStaff)", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the authed owed-view check.");
  });

  test("landing renders; owed section expands to the derivation note when present", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem("veritas_token", t as string); } catch {} }, TOKEN);
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    const toggle = page.getByTestId("owed-section-toggle");
    if (await toggle.count()) {
      await toggle.click();
      await page.waitForTimeout(600);
      await expect(page.getByText(/What each person owes comes from the instruments assigned/i)).toBeVisible();
    } else {
      test.skip(true, "No VeritaStaff testing personnel on this lab; owed section is hidden by design.");
    }
    await ctx.close();
  });
});
