// tests/playwright/veritacomp-employee-pdf.spec.ts
//
// Gate 3 step 8 for the employee competency record PDF (Phase 3b). Loads an
// employee's competency view and clicks Download PDF, then asserts the real
// browser download fires with the expected filename. This is the browser
// exercise CLAUDE.md section 5/Gate 3 requires for a customer-clickable download
// (server-only checks miss the token/blob/disposition path, per PR #286).
//
// Env-gated: PW_TOKEN (writer/LD) + PW_LAB_ID + PW_EMPLOYEE_ID (an employee with
// >=1 assigned instrument, so the Download PDF button renders). Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_EMPLOYEE_ID=25 npx playwright test veritacomp-employee-pdf

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const EMP = process.env.PW_EMPLOYEE_ID;

test.describe("VeritaComp: employee record PDF download", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !EMP, "Set PW_TOKEN, PW_LAB_ID, PW_EMPLOYEE_ID to run the record-PDF check.");
  });

  test("Download PDF produces the per-employee record PDF", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app/employee/${EMP}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const btn = page.locator('[data-testid="download-record-pdf"]');
    const hasBtn = await btn.isVisible().catch(() => false);
    test.skip(!hasBtn, "No assigned test systems for this employee (button not shown).");

    // The button fetches the record-pdf endpoint (server renders synchronously,
    // returns { token }), then navigates an <a download> to /api/pdf/<token>.
    const [download] = await Promise.all([
      page.waitForEvent("download", { predicate: (d) => /VeritaComp_Record/i.test(d.suggestedFilename()), timeout: 45000 }),
      btn.click(),
    ]);
    expect(download.suggestedFilename(), "download filename").toMatch(/VeritaComp_Record.*\.pdf/i);
    const savedPath = await download.path();
    expect(savedPath, "download saved to disk").toBeTruthy();

    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
