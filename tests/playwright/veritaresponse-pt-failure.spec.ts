// tests/playwright/veritaresponse-pt-failure.spec.ts
//
// Authed smoke for Build #3: the PT-failure investigation element in
// VeritaResponse. The "New Finding" dialog has a record-type toggle; choosing
// "PT failure" reveals the PT-specific head fields (program, event, analyte,
// score, root-cause category) and re-titles the dialog. Non-destructive: it only
// exercises the form UI, it does not submit a finding.
//
// Env-gated: PW_TOKEN (writer on a veritaresponse-enabled lab) + PW_LAB_ID.
//
//   PW_TOKEN=... PW_LAB_ID=25 npx playwright test veritaresponse-pt-failure

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;

test.describe("VeritaResponse — PT-failure investigation", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB, "Set PW_TOKEN (writer) and PW_LAB_ID to run the PT-failure form check.");
  });

  test("New Finding dialog toggles to PT failure and reveals PT fields", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritaresponse`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);

    const newBtn = page.getByRole("button", { name: /New Finding/i });
    if (!(await newBtn.count())) {
      test.skip(true, "New Finding button not present (no veritaresponse write access in this harness).");
    }
    await newBtn.first().click();
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toBeVisible();

    // Toggle to PT failure.
    await page.getByRole("button", { name: "PT failure", exact: true }).click();
    await page.waitForTimeout(300);

    // PT head fields appear.
    await expect(page.getByText("PT program / provider")).toBeVisible();
    await expect(page.getByText("Root-cause category")).toBeVisible();
    await expect(page.getByText(/493\.801\(b\)/)).toBeVisible();
    // Dialog re-titled + submit relabeled.
    await expect(page.getByText("Log PT Failure Investigation")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log PT Failure" })).toBeVisible();

    await ctx.close();
  });
});
