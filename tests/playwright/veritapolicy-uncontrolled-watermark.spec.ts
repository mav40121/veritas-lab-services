// tests/playwright/veritapolicy-uncontrolled-watermark.spec.ts
//
// Gate 3 step 8 browser exercise for the VeritaPolicy "UNCONTROLLED COPY"
// watermark toggle (PR #1283). The toggle is off by default so the in-system
// copy stays the controlled master; when checked it must append
// ?uncontrolled=true to the per-policy Word download so the server stamps the
// diagonal watermark.
//
// Drives the real toolbar checkbox and the real per-row "Download Word starter"
// button, intercepting the DOCX request to assert the query param in both
// states (off -> no param, on -> uncontrolled=true). The DOCX response is
// stubbed with a tiny 200 so no real document is generated or saved.
//
// Env: PW_BASE, PW_TOKEN (a VeritaPolicy owner), PW_POLICY_LAB (a lab id the
// owner can download starters from). Skips without them so the compile-only
// smoke gate stays green.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_POLICY_LAB || "";

test.describe("VeritaPolicy — UNCONTROLLED COPY watermark toggle", () => {
  test("off by default; toggle drives ?uncontrolled=true on the download", async ({ page }) => {
    if (!TOKEN || !LAB) {
      test.skip(true, "Needs PW_TOKEN + PW_POLICY_LAB (a lab the owner can download from).");
      return;
    }

    // Capture every per-policy DOCX request URL and stub a tiny 200 so the click
    // completes without generating or saving a real document.
    const docxCalls: string[] = [];
    await page.route(/\/api\/labs\/\d+\/veritapolicy\/templates\/[^/]+\/docx/, async route => {
      docxCalls.push(route.request().url());
      await route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "content-disposition": 'attachment; filename="stub.docx"',
        },
        body: Buffer.from("PK"), // minimal, never opened
      });
    });

    await page.setViewportSize({ width: 1400, height: 950 });
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritapolicy-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3500);

    // The toggle exists and is OFF by default (controlled master stays clean).
    const toggle = page.getByRole("checkbox", { name: /Uncontrolled Copy/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();

    const downloadBtn = page.getByRole("button", { name: "Download Word starter" }).first();

    // Default (OFF): the download must NOT carry the watermark param.
    docxCalls.length = 0;
    await downloadBtn.click();
    await expect.poll(() => docxCalls.length, { timeout: 8000 }).toBeGreaterThan(0);
    expect(
      docxCalls[docxCalls.length - 1],
      "default download omits the watermark param"
    ).not.toMatch(/uncontrolled=/);

    // Flip ON: the next download must carry uncontrolled=true.
    await toggle.check();
    await expect(toggle).toBeChecked();
    docxCalls.length = 0;
    await downloadBtn.click();
    await expect.poll(() => docxCalls.length, { timeout: 8000 }).toBeGreaterThan(0);
    expect(
      docxCalls[docxCalls.length - 1],
      "watermarked download carries uncontrolled=true"
    ).toMatch(/[?&]uncontrolled=true/);
  });
});
