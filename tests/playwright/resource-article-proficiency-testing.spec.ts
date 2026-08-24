// tests/playwright/resource-article-proficiency-testing.spec.ts
//
// Gate 3 step 8 evidence for the new public PT resource article. Asserts the
// new page renders (not a 404) with its verified regulatory content, and that
// it is listed on the Resources index.
//
// Public pages, no auth. Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const SLUG = "/resources/proficiency-testing-clia-pt-referral";

test.describe("Proficiency Testing resource article", () => {
  test("PT article page renders with verified content", async ({ page }) => {
    await page.goto(`${BASE}${SLUG}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    expect(body).toContain("Proficiency Testing Under CLIA");
    // Verified regulatory anchors that must be present and correct.
    expect(body).toContain("Subpart I");
    expect(body).toContain("493.1281");
    expect(body).toContain("July 11, 2024");
    expect(body).toContain("VeritaPT");
  });

  test("PT article is listed on the Resources index", async ({ page }) => {
    await page.goto(`${BASE}/resources`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const body = (await page.textContent("body")) || "";
    expect(body).toContain("Proficiency Testing Under CLIA");
  });
});
