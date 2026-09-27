// tests/playwright/veritapolicy-signature-report.spec.ts
//
// Gate 3 step 8 for LHF-7 (combined per-policy signature report). The VeritaDC
// document View modal now offers a "Signature report (Excel)" button that
// downloads one workbook fusing the director sign-off, the writer attestation
// roster, and the Staff Portal kiosk signatures. Server verify scripts test the
// row-join in isolation; this drives the real click and asserts a non-empty
// .xlsx download actually reaches the browser.
//
// Env-gated: PW_TOKEN (member of a VeritaDC-enabled lab with >=1 policy document)
// + PW_LAB_ID. Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritapolicy-signature-report

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("VeritaPolicy: combined signature report download", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the signature-report download check.");
  });

  test("View modal downloads a non-empty signature-report .xlsx", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app/my-policies`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // Open the first document's View modal.
    const viewBtn = page.getByRole("button", { name: /^view$/i }).first();
    const hasDoc = await viewBtn.isVisible().catch(() => false);
    test.skip(!hasDoc, "No policy document present on this lab to open.");
    await viewBtn.click();

    // The signature-report button lives in the modal alongside the audit trail.
    const sigBtn = page.locator('[data-testid="signature-report-button"]');
    await expect(sigBtn.first()).toBeVisible({ timeout: 15000 });

    // Drive the actual download and assert the file.
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      sigBtn.first().click(),
    ]);
    const name = download.suggestedFilename();
    expect(name, `download name (${name})`).toMatch(/VeritaPolicy_Signature_Report_.*\.xlsx$/);
    const path = await download.path();
    expect(path, "download saved to disk").toBeTruthy();
    const fs = require("fs");
    const size = path ? fs.statSync(path).size : 0;
    expect(size, `xlsx bytes (${size})`).toBeGreaterThan(2000);
    // No page errors surfaced by the click.
    expect(errors, `page errors after click: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
