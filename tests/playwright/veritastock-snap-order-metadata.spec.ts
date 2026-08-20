// tests/playwright/veritastock-snap-order-metadata.spec.ts
//
// Gate 3 step 8 for the Snap Order metadata fields (SCAHC request, 2026-08-20):
//   - PO # and Account # inputs plus an editable "Name & Reason for Snap Order"
//     textarea on the Snap Order form. Values are carried onto the generated PDF.
//
// PW_TOKEN-gated UI exercise (skips cleanly in the reporting-only smoke run so it
// does not fail before deploy). Filling the fields is the browser receipt on prod.
//
// Env: PW_BASE (default prod), PW_TOKEN (owner JWT), PW_LAB_ID (default 3).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaStock Snap Order metadata fields", () => {
  test("PO #, Account #, and Name & Reason fields exist and accept input", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN not set — skipping authenticated UI exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritastock/snap-order`);

    const po = page.getByTestId("snap-po-number");
    const acct = page.getByTestId("snap-account-number");
    const reason = page.getByTestId("snap-name-reason");

    await expect(po).toBeVisible({ timeout: 15000 });
    await expect(acct).toBeVisible();
    await expect(reason).toBeVisible();

    await po.fill("PO-2026-0042");
    await acct.fill("ACCT-778812");
    await reason.fill("Christian Bartlett\nOutbreak surge, need BD tubes now");

    // Text inputs hold exactly what was typed; the textarea preserves the newline.
    await expect(po).toHaveValue("PO-2026-0042");
    await expect(acct).toHaveValue("ACCT-778812");
    await expect(reason).toHaveValue(/Outbreak surge, need BD tubes now/);
  });
});
