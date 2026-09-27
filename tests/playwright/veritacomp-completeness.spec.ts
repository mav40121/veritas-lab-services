// tests/playwright/veritacomp-completeness.spec.ts
//
// Gate 3 step 8 for the competency completeness rule + department-grouped landing
// (Phase 1). Michael's rule: an element is PASS only with its data AND passed; no
// data -> "Incomplete"; the assessment reads "In progress" until every element for
// every test is data-or-N/A; and an incomplete assessment cannot be signed. The
// landing groups programs by department to line up with the coverage map.
//
// Env-gated: PW_TOKEN (writer/LD on a VeritaComp lab) + PW_LAB_ID + PW_PROGRAM_ID
// (a technical program whose assessment has NO per-element data yet). Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_PROGRAM_ID=23 npx playwright test veritacomp-completeness

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const PROGRAM = process.env.PW_PROGRAM_ID;

test.describe("VeritaComp: completeness (no PASS without data) + department landing", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !PROGRAM, "Set PW_TOKEN, PW_LAB_ID, PW_PROGRAM_ID to run the completeness check.");
  });

  test("empty assessment reads In progress / Incomplete and cannot be signed", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app/${PROGRAM}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    const tab = page.getByRole("tab", { name: /assessments/i }).or(page.getByRole("button", { name: /^assessments$/i }));
    if (await tab.first().isVisible().catch(() => false)) await tab.first().click().catch(() => {});
    await page.waitForTimeout(1000);

    // An assessment with element rows but no specimen/observer/date must NOT read PASS.
    const card = page.locator('.rounded-lg, [class*="rounded"]').filter({ hasText: /6 CLIA Competency Elements/i }).first();
    const hasCard = await card.isVisible().catch(() => false);
    test.skip(!hasCard, "No assessment with the 6-element summary present on this program.");

    // Element table shows "Incomplete", not PASS, when there is no data.
    await expect(card.getByText(/Incomplete/i).first()).toBeVisible({ timeout: 8000 });
    // Top chip reads "In progress".
    await expect(card.getByText(/In progress/i).first()).toBeVisible({ timeout: 8000 });

    // Sign & Complete is blocked on an incomplete assessment.
    await card.getByRole("button", { name: /sign & complete/i }).first().click();
    await expect(page.getByText(/Cannot sign: assessment incomplete/i).first()).toBeVisible({ timeout: 8000 });
    // The sign dialog must NOT have opened.
    await expect(page.getByTestId("input-sign-date")).toHaveCount(0);

    await ctx.close();
  });

  test("landing groups programs by department", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    // At least one uppercase department header should render above the program cards.
    // (Chemistry / Hematology / Generalist etc., derived from each program's department.)
    const headers = page.locator("h3.uppercase, h3[class*='uppercase']");
    expect(await headers.count(), "department section headers present").toBeGreaterThan(0);
    await ctx.close();
  });
});
