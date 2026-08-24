// tests/playwright/resource-article-d-polish.spec.ts
//
// Gate 3 step 8 evidence for the resource-article precision polish:
//   - TEa: Subpart I title corrected to "Proficiency Testing Programs for
//     Nonwaived Testing"; cal-ver acceptance criterion cites 493.1255(b)(2).
//   - Method comparison: CLSI EP09c (current edition), not EP09-A3.
// Public pages, no auth. Env: PW_BASE (default production www).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("Resource-article precision polish is live", () => {
  test("TEa page: correct Subpart I title and 493.1255(b)(2)", async ({ page }) => {
    await page.goto(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const body = (await page.textContent("body")) || "";
    expect(body).not.toContain("404 Page Not Found");
    expect(body).toContain("Proficiency Testing Programs for Nonwaived Testing");
    expect(body).not.toContain("by Specialty and Subspecialty");
    expect(body).toContain("493.1255(b)(2)");
  });

  test("Method comparison page: cites EP09c, not EP09-A3", async ({ page }) => {
    await page.goto(`${BASE}/resources/how-to-perform-method-comparison-study`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);
    const body = (await page.textContent("body")) || "";
    expect(body).toContain("EP09c");
    expect(body).not.toContain("EP09-A3");
  });
});
