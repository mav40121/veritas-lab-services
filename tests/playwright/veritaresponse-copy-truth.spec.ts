// tests/playwright/veritaresponse-copy-truth.spec.ts
//
// Gate 3 step-8 evidence for the VeritaResponse public-copy truth fix (audit
// #10 + #12). The suite page claimed VeritaResponse "Renders the federal
// CMS-2567 PDF" (implying the official government form) and cross-links "for the
// cited standard" (implying a standard-matched study). This loads the PUBLIC
// /veritaassure page and asserts the corrected copy renders and the overstated
// claims are gone. No token needed; runs live in CI.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("VeritaResponse copy truth", () => {
  test("the VeritaAssure suite page states CMS-2567-compatible, not 'federal CMS-2567'", async ({ page }) => {
    await page.goto(`${BASE}/veritaassure`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();

    expect(body).toContain("CMS-2567-compatible Plan of Correction PDF");
    expect(body).not.toContain("Renders the federal CMS-2567");
    expect(body).not.toContain("for the cited standard");
  });
});
