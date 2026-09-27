// tests/playwright/veritaqc-iqcp-entry.spec.ts
//
// Gate 3 step 8 for the IQCP discoverability improvement: the IQCP builder was
// only reachable under VeritaDC (document control), but a lab manager doing daily
// QC looks for it in VeritaQC (an IQCP is a risk-based quality control plan). This
// asserts VeritaQC now surfaces an IQCP entry-point card that links to the builder.
//
// Env-gated: PW_TOKEN (member of a VeritaQC-enabled lab) + PW_LAB_ID. Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritaqc-iqcp-entry

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("VeritaQC — IQCP entry point", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN and PW_LAB_ID to run the VeritaQC IQCP entry check.");
  });

  test("VeritaQC surfaces an IQCP card that links to the builder", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritaqc-app`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    // The IQCP card + its link.
    await expect(page.getByText(/IQCP \(Individualized Quality Control Plan\)/i).first()).toBeVisible();
    const link = page.locator('[data-testid="veritaqc-iqcp-link"]');
    await expect(link.first()).toBeVisible();
    const href = await link.first().getAttribute("href");
    expect(href, `IQCP link points at the builder (got ${href})`).toContain(`/labs/${LAB}/veritapolicy-app/iqcp`);
    await ctx.close();
  });
});
