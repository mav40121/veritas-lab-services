// tests/playwright/veritaresponse-internal-nce.spec.ts
//
// Gate 3 step 8 for parking-lot #36: the VeritaResponse internal NCE create UI.
// Verifies the New Finding dialog offers a third record type ("Internal event
// (NCE)"), that selecting it shows the event-date / discovered-by fields and
// drops the survey-only accreditor field, and that the submit label switches to
// "Log Internal Event". Env-gated: set PW_TOKEN (owner/admin) and PW_LAB_ID to
// run against prod; skips otherwise.
//   PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritaresponse-internal-nce

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID || "3";

test.describe("VeritaResponse internal NCE create UI (#36)", () => {
  test.beforeEach(() => test.skip(!TOKEN, "set PW_TOKEN (owner/admin) to run the internal-NCE UI check."));

  test("New Finding dialog offers Internal event (NCE) with event fields, no accreditor", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritaresponse`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    // Open the create dialog.
    await page.getByRole("button", { name: "New Finding" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 8000 });

    // Inspection is the default: the accreditor field shows.
    await expect(dialog.getByText("Accreditor")).toBeVisible();

    // The third record type renders and, when selected, swaps the head fields.
    const nceToggle = dialog.getByRole("button", { name: "Internal event (NCE)" });
    await expect(nceToggle).toBeVisible();
    await nceToggle.click();

    await expect(dialog.getByText("Event date")).toBeVisible();
    await expect(dialog.getByText("Discovered by")).toBeVisible();
    // Survey-only fields drop for an internal NCE.
    await expect(dialog.getByText("Accreditor")).toHaveCount(0);
    await expect(dialog.getByText("Finding #")).toHaveCount(0);
    // Submit label reflects the internal-event path.
    await expect(dialog.getByRole("button", { name: "Log Internal Event" })).toBeVisible();

    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
