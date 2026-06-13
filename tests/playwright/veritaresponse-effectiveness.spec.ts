// tests/playwright/veritaresponse-effectiveness.spec.ts
//
// Gate 3 receipt for Wave C3 (2026-06-12): the VeritaResponse finding page
// shows an Effectiveness monitoring panel; with a completion date set, the
// lab can start 30/60/90-day checkpoints.
//
// Needs creds: PW_TOKEN, PW_LAB_ID, PW_FINDING_ID (a finding with a completion
// date). Skips cleanly without them.
//
// Run: PW_TOKEN=... PW_LAB_ID=2 PW_FINDING_ID=1 npx playwright test veritaresponse-effectiveness

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const FINDING_ID = process.env.PW_FINDING_ID || "";

test.describe("VeritaResponse effectiveness monitoring (Wave C3)", () => {
  test("finding page shows the effectiveness panel and can start monitoring", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID || !FINDING_ID, "PW_TOKEN + PW_LAB_ID + PW_FINDING_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaresponse/${FINDING_ID}`);
    const panel = page.getByText(/Effectiveness monitoring/i).first();
    await expect(panel).toBeVisible({ timeout: 20000 });
    // Either the start button (not yet generated) or 30-day checkpoint rows.
    const start = page.getByRole("button", { name: /Start 30\/60\/90 day monitoring/i });
    const dayRow = page.getByText(/30-day/i);
    const present = (await start.count()) + (await dayRow.count());
    expect(present).toBeGreaterThanOrEqual(1);
    if (await start.count() && await start.isEnabled()) {
      await start.click();
      await expect(page.getByText(/30-day/i).first()).toBeVisible({ timeout: 15000 });
    }
  });
});
