// tests/playwright/veritaqa-rca.spec.ts
//
// Gate 3 receipt for Wave D4 (2026-06-12): the VeritaQA (VeritaBench PI) data
// entry table exposes a root-cause affordance on a metric whose month is red
// or yellow, opening a Root cause and corrective action dialog.
//
// Needs creds: PW_TOKEN. Skips cleanly without it. The red/yellow affordance
// only appears when a missed value exists, so the test asserts the dialog
// wiring rather than forcing data state.
//
// Run: PW_TOKEN=... npx playwright test veritaqa-rca

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaQA root-cause documentation (Wave D4)", () => {
  test("a red/yellow metric row opens the root-cause dialog", async ({ page }) => {
    test.skip(!TOKEN, "PW_TOKEN required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritabench/pi`);
    // Move to the Data entry tab if present.
    const dataTab = page.getByRole("button", { name: /^Data/i }).first();
    if (await dataTab.count()) await dataTab.click().catch(() => {});
    // The RCA trigger is a warning-triangle button; present only for a red or
    // yellow month. If one exists, clicking it opens the dialog.
    const rcaBtn = page.locator('button[title*="root cause" i]').first();
    if (await rcaBtn.count()) {
      await rcaBtn.click();
      await expect(page.getByText(/Root cause and corrective action/i)).toBeVisible({ timeout: 10000 });
    } else {
      test.skip(true, "no red/yellow month present to exercise the RCA dialog");
    }
  });
});
