// tests/playwright/veritaceu-free-ce-catalog.spec.ts
//
// Gate 3 step 8 for the free-CE catalog. The VeritaCEU card now carries a
// "Find free CE" panel of verified no-cost CE providers. Server verify checks
// the data shape; this asserts the panel renders in the real page and its links
// point at the verified provider hosts over https (no hash routes, no blanks).
//
// Env-gated: PW_TOKEN (member of a VeritaStaff-enabled lab with >=1 employee)
// + PW_LAB_ID. Optional PW_EMPLOYEE_ID to deep-link a specific employee.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritaceu-free-ce-catalog

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const EMP = process.env.PW_EMPLOYEE_ID;

const EXPECTED_HOSTS = ["reach.cdc.gov", "aruplab.com", "labroots.com", "api-pt.com"];

test.describe("VeritaCEU: free-CE catalog panel", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the free-CE catalog check.");
  });

  test("panel renders verified free-CE links over https", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);

    if (EMP) {
      await page.goto(`${BASE}/labs/${LAB}/veritastaff-app/${EMP}`, { waitUntil: "domcontentloaded" });
    } else {
      await page.goto(`${BASE}/labs/${LAB}/veritastaff-app`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3000);
      const card = page.locator('[data-testid="staff-employee-card"]').first();
      const hasEmp = await card.isVisible().catch(() => false);
      test.skip(!hasEmp, "No employee on this lab to open.");
      await card.click();
    }
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    const panel = page.locator('[data-testid="free-ceu-resources"]').first();
    await expect(panel).toBeVisible({ timeout: 15000 });
    // <details> may be collapsed; expand it so its links are queryable.
    await panel.locator("summary").click();

    const links = panel.locator('[data-testid="free-ceu-link"]');
    const count = await links.count();
    expect(count, `free-CE link count (${count})`).toBeGreaterThanOrEqual(4);

    const hrefs: string[] = [];
    for (let i = 0; i < count; i++) {
      const href = (await links.nth(i).getAttribute("href")) || "";
      hrefs.push(href);
      expect(href, `link ${i} is https (${href})`).toMatch(/^https:\/\//);
      expect(href, `link ${i} is not a hash route (${href})`).not.toContain("/#/");
    }
    for (const host of EXPECTED_HOSTS) {
      expect(hrefs.some((h) => h.includes(host)), `expected a link to ${host}`).toBeTruthy();
    }
    await ctx.close();
  });
});
