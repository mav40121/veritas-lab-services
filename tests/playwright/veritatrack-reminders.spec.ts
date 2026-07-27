// tests/playwright/veritatrack-reminders.spec.ts
//
// Gate 3 for the VeritaTrack reminder settings panel (2026-07-26, Longstreth
// feature 1, PR 2). Drives the real browser: opens the Reminders tab, adds a
// recipient, sets lead-days + overdue cadence, enables, saves, and asserts the
// values persist across a reload. The nightly send logic is covered by
// scripts/verify-veritatrack-reminders.mts; this proves the customer-clickable
// UI actually round-trips to /api/labs/:labId/veritatrack/reminder-config.
//
// SAFETY: captures the lab's existing reminder config up front and restores it
// in a finally, so a real lab (lab 3 here) is never left with reminders enabled
// or a test recipient attached.
//
// Needs creds: PW_TOKEN + PW_LAB_ID. Skips cleanly without them.
// Run: PW_TOKEN=... PW_LAB_ID=3 npx playwright test veritatrack-reminders

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const TEST_EMAIL = "reminder-spec@example.com";

test.describe("VeritaTrack reminder settings", () => {
  test("the Reminders tab saves recipient + cadence and persists on reload", async ({ page, request }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
    const cfgUrl = `${BASE}/api/labs/${LAB_ID}/veritatrack/reminder-config`;

    // Capture the current config so we can put the lab back exactly as we found it.
    const before = await request.get(cfgUrl, { headers: auth });
    expect(before.ok()).toBeTruthy();
    const original = await before.json();

    try {
      await injectAuth(page, BASE, TOKEN);
      await page.goto(`${BASE}/labs/${LAB_ID}/veritatrack-app`, { waitUntil: "networkidle" });

      // Open the Reminders tab.
      await page.getByTestId("reminders-tab").click();
      const panel = page.getByTestId("reminders-panel");
      await expect(panel).toBeVisible({ timeout: 15000 });

      // Add a recipient.
      await panel.getByTestId("recipient-email-input").fill(TEST_EMAIL);
      await panel.getByTestId("recipient-add").click();
      await expect(panel.getByTestId("recipient-row").filter({ hasText: TEST_EMAIL })).toBeVisible();

      // Set timing and enable.
      await panel.getByTestId("lead-days-input").fill("7");
      await panel.getByTestId("cadence-input").fill("3");
      const enableSwitch = panel.getByRole("switch");
      if ((await enableSwitch.getAttribute("aria-checked")) !== "true") {
        await enableSwitch.click();
      }
      await expect(enableSwitch).toHaveAttribute("aria-checked", "true");

      // Save and confirm the success indicator.
      await panel.getByTestId("reminders-save").click();
      await expect(page.getByTestId("reminders-saved")).toBeVisible({ timeout: 10000 });

      // Reload and confirm the settings persisted (round-trip through the API).
      await page.reload({ waitUntil: "networkidle" });
      await page.getByTestId("reminders-tab").click();
      const panel2 = page.getByTestId("reminders-panel");
      await expect(panel2).toBeVisible({ timeout: 15000 });
      await expect(panel2.getByTestId("recipient-row").filter({ hasText: TEST_EMAIL })).toBeVisible();
      await expect(panel2.getByRole("switch")).toHaveAttribute("aria-checked", "true");
      await expect(panel2.getByTestId("lead-days-input")).toHaveValue("7");
      await expect(panel2.getByTestId("cadence-input")).toHaveValue("3");
    } finally {
      // Restore the lab to its pre-test config no matter what.
      await request.put(cfgUrl, {
        headers: auth,
        data: {
          enabled: !!original.enabled,
          lead_days: original.lead_days,
          overdue_cadence_days: original.overdue_cadence_days,
          recipients: original.recipients || [],
        },
      });
    }
  });
});
