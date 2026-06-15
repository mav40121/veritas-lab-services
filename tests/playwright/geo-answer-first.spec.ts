// tests/playwright/geo-answer-first.spec.ts
//
// Gate 3 receipt for GEO Item 2 (answer-first structure). AI answer engines
// extract the first sentence after a question-style heading, so each such
// heading on the TEa article is immediately followed by a single declarative
// answer. The article prose is client-rendered, so this loads the page in a
// browser and asserts the front-loaded answers are present.
//
// Run: npx playwright test geo-answer-first
//      PW_BASE=http://127.0.0.1:5099 npx playwright test geo-answer-first

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("GEO: answer-first under question-style headings", () => {
  test("TEa article front-loads a direct answer under each question heading", async ({ page }) => {
    await page.goto(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`, { waitUntil: "networkidle" });
    const body = await page.locator("body").innerText();
    // "What Is CLIA TEa?" answer-first definition (pre-existing)
    expect(body).toContain("CLIA TEa (Total Allowable Error) is the maximum permissible difference");
    // "Why Manufacturer Criteria Aren't Always Sufficient" front-loaded answer
    expect(body).toContain("Manufacturer criteria are a vendor performance claim, not a federally published acceptance limit");
    // "How to Apply TEa to Calibration Verification" front-loaded answer
    expect(body).toContain("To apply TEa to calibration verification, calculate each calibration level's difference from its target");
  });
});
