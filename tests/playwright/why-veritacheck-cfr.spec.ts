// tests/playwright/why-veritacheck-cfr.spec.ts
//
// Gate 3 receipt + regression guard for the 2026-06-14 hematology CFR fix.
//
// The "Why VeritaCheck" page (and its PDF) claimed the CFR citation is
// "specialty-correct" while giving a specialty-INCORRECT example:
// "Hematology §493.927". §493.927 is General Immunology; hematology PT
// acceptable-performance criteria live in §493.941 (eCFR-verified). Fixed to
// §493.941 on both the page and the PDF source.
//
// This asserts the live page names the correct section and no longer carries
// the wrong one. Logged-out, no creds.
//
// Run: npx playwright test why-veritacheck-cfr

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Why-VeritaCheck page: correct hematology CFR citation", () => {
  test("names Hematology §493.941, not §493.927", async ({ page }) => {
    await page.goto(`${BASE}/resources/why-veritacheck-vs-legacy-verification`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    expect(body).toContain("Hematology §493.941");
    expect(body).not.toContain("Hematology §493.927");
  });
});
