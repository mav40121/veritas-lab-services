// tests/playwright/veritacomp-employee-sign.spec.ts
//
// Gate 3 step 8 for the employee-centric Sign & Complete (Phase 3a). Fills every
// assigned test system complete (via the API), then drives the REAL browser
// Sign & Complete: opens the panel, enters the evaluator, confirms, and asserts
// the record shows Signed and locked, and stays locked across reload. The
// completeness gate is enforced server-side over every assigned instrument.
// Cleans up after itself (unlock + clear) so the sandbox is left open.
//
// Env-gated: PW_TOKEN (writer/LD) + PW_LAB_ID + PW_EMPLOYEE_ID (an employee with
// >=1 assigned instrument). Skips otherwise (so it is inert in CI).
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_EMPLOYEE_ID=25 npx playwright test veritacomp-employee-sign

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const EMP = process.env.PW_EMPLOYEE_ID;

// A complete (data, not N/A) payload for a given element number.
function elementData(num: number): any {
  const today = new Date().toISOString().slice(0, 10);
  switch (num) {
    case 1: return { num, specimenId: "SIGN-TEST", observerInitials: "MV", passed: true };
    case 2: return { num, evidence: "reviewed", date: today, passed: true };
    case 3: return { num, qcDate: today, passed: true };
    case 4: return { num, dateObserved: today, observerInitials: "MV", passed: true };
    case 5: return { num, sampleType: "blind", sampleId: "S1", acceptable: true, passed: true };
    case 6: return { num, quizId: "Q1", score: 100, dateTaken: today, passed: true };
    case 7: return { num, dateObserved: today, observerInitials: "MV", passed: true };
    case 8: return { num, functionAssessed: "review", date: today, passed: true };
    default: return { num };
  }
}

test.describe("VeritaComp: employee-centric Sign & Complete", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !EMP, "Set PW_TOKEN, PW_LAB_ID, PW_EMPLOYEE_ID to run the sign check.");
  });

  test("completing every test system enables sign, and signing locks the record", async ({ browser, request }) => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const empUrl = `${BASE}/api/labs/${LAB}/competency/employee/${EMP}`;

    // Start from an open record: if the latest is locked, unlock it first.
    let g = await (await request.get(empUrl, { headers: auth })).json();
    if (g.record?.locked && g.record?.assessmentId) {
      await request.post(`${BASE}/api/labs/${LAB}/competency/assessments/${g.record.assessmentId}/unlock`, { headers: auth });
      g = await (await request.get(empUrl, { headers: auth })).json();
    }
    const elementCount: number = g.elementCount || 6;
    const systems: any[] = g.testSystems || [];
    test.skip(systems.length === 0, "No assigned test systems for this employee.");

    // Complete every assigned test system via the API (the sign gate needs all).
    for (const ts of systems) {
      const elements = [];
      for (let n = 1; n <= elementCount; n++) elements.push(elementData(n));
      const r = await request.put(`${BASE}/api/labs/${LAB}/competency/employee/${EMP}/test-system/${ts.instrumentId}`, { headers: auth, data: { elements } });
      expect(r.ok(), `PUT instrument ${ts.instrumentId} => ${r.status()}`).toBeTruthy();
    }

    // Browser: the real Sign & Complete flow.
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app/employee/${EMP}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const signBtn = page.locator('[data-testid="open-sign"]');
    await expect(signBtn).toBeVisible({ timeout: 8000 });
    await expect(signBtn).toBeEnabled();
    await signBtn.click();
    await page.locator('[data-testid="eval-name"]').fill("Michael Veri");
    await page.locator('[data-testid="eval-title"]').fill("Technical Supervisor");
    await page.locator('[data-testid="eval-initials"]').fill("MV");
    await page.locator('[data-testid="confirm-sign"]').click();
    await expect(page.locator('[data-testid="signed-banner"]')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/Signed and complete/i).first()).toBeVisible();

    // Locked state persists across reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await expect(page.locator('[data-testid="signed-banner"]')).toBeVisible({ timeout: 8000 });
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();

    // Confirm server-side lock, then clean up: unlock + clear each instrument.
    const after = await (await request.get(empUrl, { headers: auth })).json();
    expect(after.record?.locked, "record locked server-side").toBeTruthy();
    if (after.record?.assessmentId) {
      await request.post(`${BASE}/api/labs/${LAB}/competency/assessments/${after.record.assessmentId}/unlock`, { headers: auth });
    }
    for (const ts of systems) {
      const blank = [];
      for (let n = 1; n <= elementCount; n++) blank.push({ num: n });
      await request.put(`${BASE}/api/labs/${LAB}/competency/employee/${EMP}/test-system/${ts.instrumentId}`, { headers: auth, data: { elements: blank } });
    }
  });
});
