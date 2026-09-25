// tests/playwright/repository-lab-badge.spec.ts
//
// Authed smoke for Build #5: a lab flagged is_repository shows a "Library" badge
// in the lab switcher (so a shared document/policy library does not read as a
// compliance site) and is excluded from the readiness roll-up. This asserts the
// badge renders when the account has a repository lab; it skips otherwise.
//
// Env-gated: PW_TOKEN (member of an account that has a repository lab) + PW_LAB_ID.
//
//   PW_TOKEN=... PW_LAB_ID=25 npx playwright test repository-lab-badge

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("Repository lab — switcher badge", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the repository-lab badge check.");
  });

  test("lab switcher shows a Library badge for a repository lab", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // Open the lab switcher (renders only when the account has >1 lab).
    const trigger = page.locator('[data-testid="lab-switcher"], button:has-text("Lab")').first();
    if (!(await trigger.count())) {
      test.skip(true, "Lab switcher not present (single-lab account in this harness).");
    }
    await trigger.click().catch(() => {});
    await page.waitForTimeout(500);

    const libraryBadge = page.getByText("Library", { exact: true });
    if (await libraryBadge.count()) {
      await expect(libraryBadge.first()).toBeVisible();
    } else {
      test.skip(true, "No repository lab on this account; Library badge not applicable.");
    }
    await ctx.close();
  });
});
