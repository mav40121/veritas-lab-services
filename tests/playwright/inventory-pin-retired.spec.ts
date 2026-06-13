// tests/playwright/inventory-pin-retired.spec.ts
//
// Gate 3 receipt for the Inventory Kiosk PIN retirement (2026-06-12).
//
// Michael on /labs/2/members: "I thought we had eliminated pins?" — correct;
// CLIA+PIN auth was retired 2026-06-09 (PR #689) when the Staff Portal
// unified on email + password, but the Wave K4 "Inventory Kiosk PIN" card on
// LabMembersPage and the standalone /inventory kiosk route survived that
// pass. This spec asserts both leftovers are gone:
//   1. /labs/:labId/members renders no Inventory Kiosk PIN card, and
//   2. /inventory redirects to /staff-access (no PIN prompt).
//
// Run: PW_TOKEN=... PW_LAB_ID=2 npx playwright test inventory-pin-retired

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

test.describe("Inventory Kiosk PIN retirement", () => {
  test("Lab Members no longer shows the Inventory Kiosk PIN card", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/members`);
    await expect(page.getByText(/Lab Members/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/Inventory Kiosk PIN/i)).toHaveCount(0);
    await expect(page.getByTestId("inventory-pin-card")).toHaveCount(0);
  });

  test("Lab Members no longer shows the retired view-only seat model", async ({ page }) => {
    // Second retirement leftover on the same page (Michael: "what is going
    // on with the 0 out of 5 view only slots?"): the per-seat view-only
    // counter, the Seat type dropdown, and the $99/yr extras copy are gone;
    // read-and-sign staff are pointed at the Staff Portal instead.
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await page.goto(`${BASE}/`);
    await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/members`);
    await expect(page.getByText(/Lab Members/i).first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(/view-only seats used/i)).toHaveCount(0);
    await expect(page.getByText(/\$99 per year/i)).toHaveCount(0);
    await expect(page.locator("#invite-seat-type")).toHaveCount(0);
    await expect(page.getByText(/Read-and-sign staff/i).first()).toBeVisible();
  });

  test("/inventory redirects to /staff-access (no PIN prompt)", async ({ page }) => {
    await page.goto(`${BASE}/inventory`);
    await page.waitForURL(/\/staff-access/, { timeout: 20000 });
    await expect(page.getByText(/PIN/i)).toHaveCount(0);
  });
});
