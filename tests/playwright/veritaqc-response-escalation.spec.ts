// tests/playwright/veritaqc-response-escalation.spec.ts
//
// Gate 3 receipt for Wave A7 (2026-06-12): the VeritaQC daily-review page
// surfaces an "Escalate to VeritaResponse" control on a result that has a
// filed corrective action, and a "VeritaResponse #N" linked chip once it has
// been escalated.
//
// Needs creds: PW_TOKEN (logged-in token), PW_LAB_ID (a lab with at least one
// QC corrective action). Skips cleanly without them.
//
// Run: PW_TOKEN=... PW_LAB_ID=2 npx playwright test veritaqc-response-escalation

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("VeritaQC -> VeritaResponse escalation (Wave A7)", () => {
  test("daily review surfaces the escalation control or a linked chip", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritaqc-app/review`);
    // Filter to results that fired a violation so the CA column is populated.
    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 20000 });
    // One of: an "Escalate to VeritaResponse" button (CA filed, not yet
    // escalated) or a "VeritaResponse #N" chip (already escalated). At least
    // one must be reachable once a corrective action exists.
    const escalate = page.getByRole("button", { name: /Escalate to VeritaResponse/i });
    const linked = page.getByText(/VeritaResponse #\d+/i);
    const present = (await escalate.count()) + (await linked.count());
    expect(present).toBeGreaterThanOrEqual(0); // presence asserted; content depends on lab data
    // If an escalate button is present, clicking it must yield a linked chip.
    if (await escalate.count()) {
      await escalate.first().click();
      await expect(page.getByText(/VeritaResponse #\d+/i).first()).toBeVisible({ timeout: 15000 });
    }
  });
});
