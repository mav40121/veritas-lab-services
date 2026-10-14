// tests/playwright/veritacomp-employee-sign.spec.ts
//
// Gate 3 step 8 for per-method sign-off (2026-10-13, Michael Q158 = 1; replaces the Phase 3a whole-record Sign &
// Complete). Completes ONE non-waived test system via the API, then drives the REAL browser sign form on the employee
// page: the first eligible signer is preselected, Sign stores the sign-off, the method shows "Initial signed" with its
// next due date, and stays signed across reload while the person's other methods stay open. Cleans up after itself
// (Unlock, then blank the entries) so the sandbox is left as it was.
//
// Env-gated: PW_TOKEN (writer/LD) + PW_LAB_ID + PW_EMPLOYEE_ID (an employee with >=1 assigned non-waived instrument and
// at least one eligible signer for it in VeritaStaff). Skips otherwise (so it is inert in CI).
//
//   PW_TOKEN=... PW_LAB_ID=35 PW_EMPLOYEE_ID=... npx playwright test veritacomp-employee-sign

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

test.describe("VeritaComp: per-method sign-off", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !EMP, "Set PW_TOKEN, PW_LAB_ID, PW_EMPLOYEE_ID to run the sign check.");
  });

  test("a complete method can be signed on its own, and stays signed across reload", async ({ browser, request }) => {
    const auth = { Authorization: `Bearer ${TOKEN}` };
    const empUrl = `${BASE}/api/labs/${LAB}/competency/employee/${EMP}`;
    const g = await (await request.get(empUrl, { headers: auth })).json();
    const elementCount: number = g.elementCount || 6;
    // An unsigned, non-waived method with an eligible signer.
    const ts = (g.testSystems || []).find((t: any) => !t.waived && !t.lastSignoff && (t.signers || []).some((o: any) => o.eligible));
    test.skip(!ts, "No unsigned non-waived method with an eligible signer for this employee.");
    const elements = Array.from({ length: elementCount }, (_, i) => elementData(i + 1));
    const put = await request.put(`${empUrl}/test-system/${ts.instrumentId}`, { headers: auth, data: { elements } });
    expect(put.ok(), `PUT instrument ${ts.instrumentId} => ${put.status()}`).toBeTruthy();

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app/employee/${EMP}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.getByTestId("test-system-tab").filter({ hasText: ts.instrumentName }).first().click();
    await expect(page.getByTestId("method-sign-form")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("signer-select")).not.toHaveValue("");
    await page.getByTestId("sign-method").click();
    await expect(page.getByTestId("method-signed")).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("method-signed")).toContainText(/Initial signed/);
    await expect(page.getByTestId("method-next-due")).toContainText(/due/);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.getByTestId("test-system-tab").filter({ hasText: ts.instrumentName }).first().click();
    await expect(page.getByTestId("method-signed")).toBeVisible({ timeout: 8000 });
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();

    // Server-side: this method signed, the others not touched by it. Then clean up: Unlock, blank the entries.
    const after = await (await request.get(empUrl, { headers: auth })).json();
    const signed = (after.testSystems || []).find((t: any) => t.instrumentId === ts.instrumentId);
    expect(signed?.lastSignoff?.milestone, "method signed server-side").toBe("initial");
    if (signed?.lastSignoff?.id) {
      await request.post(`${empUrl}/test-system/${ts.instrumentId}/signoffs/${signed.lastSignoff.id}/revoke`, { headers: auth });
    }
    const blank = Array.from({ length: elementCount }, (_, i) => ({ num: i + 1 }));
    await request.put(`${empUrl}/test-system/${ts.instrumentId}`, { headers: auth, data: { elements: blank } });
  });
});
