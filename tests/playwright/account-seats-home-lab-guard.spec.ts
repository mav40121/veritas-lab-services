// tests/playwright/account-seats-home-lab-guard.spec.ts
//
// Gate 3 receipt for the 2026-06-12 account-seats guard fix.
//
// Bug (Michael's screenshot, /labs/6/account/settings on SCAHC): the Team
// Members section showed his PERSONAL account's full seat list, with Remove
// and Edit Permissions links, while the NavBar was switched into a customer
// lab. Root cause: the guard compared activeLabId against isPrimaryLab, but
// POST /api/labs/me/default flips is_primary_lab on every NavBar switch, so
// the comparison was always equal and the guard never fired.
//
// Fix: /api/labs/me exposes isAccountHomeLab (static, from users.lab_id);
// the page keys the guard on it and hides the seat management list entirely
// on non-home labs (banner only).
//
// Skips unless creds are provided:
//   PW_TOKEN        — a logged-in veritas_token for a MULTI-LAB owner
//   PW_HOME_LAB     — the owner's account home lab id (users.lab_id)
//   PW_OTHER_LAB    — a different lab the owner can switch into
//   PW_BASE         — defaults to https://www.veritaslabservices.com
//
// Run: PW_TOKEN=... PW_HOME_LAB=2 PW_OTHER_LAB=6 npx playwright test account-seats-home-lab-guard

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const HOME_LAB = process.env.PW_HOME_LAB || "";
const OTHER_LAB = process.env.PW_OTHER_LAB || "";

async function auth(page: any) {
  await page.goto(`${BASE}/`);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}

test.describe("Account settings Team Members home-lab guard", () => {
  test("non-home lab shows the account-seats banner and HIDES the seat list", async ({ page }) => {
    test.skip(!TOKEN || !HOME_LAB || !OTHER_LAB, "PW_TOKEN + PW_HOME_LAB + PW_OTHER_LAB required");
    await auth(page);
    await page.goto(`${BASE}/labs/${OTHER_LAB}/account/settings`);
    // The banner explains these are account seats, not this lab's team.
    await expect(page.getByText(/seats on your account/i)).toBeVisible({ timeout: 20000 });
    // The management list must NOT render: no Remove links, no per-seat
    // Edit Permissions buttons.
    await expect(page.getByRole("button", { name: /^Remove$/ })).toHaveCount(0);
    await expect(page.getByText(/^Edit Permissions$/)).toHaveCount(0);
    // Follow-up fix (same day): the account-seat header copy and the
    // "All seats are in use" warning are account-seat UI too — hidden.
    await expect(page.getByText(/All seats are in use/i)).toHaveCount(0);
    await expect(page.getByText(/additional seats? used/i)).toHaveCount(0);
  });

  test("home lab still shows the seat management list (no banner)", async ({ page }) => {
    test.skip(!TOKEN || !HOME_LAB || !OTHER_LAB, "PW_TOKEN + PW_HOME_LAB + PW_OTHER_LAB required");
    await auth(page);
    await page.goto(`${BASE}/labs/${HOME_LAB}/account/settings`);
    // No banner on the home lab.
    await expect(page.getByText(/seats on your account/i)).toHaveCount(0);
    // The Team Members card renders its normal management content (the
    // invite-help copy is always present in the header when seats exist).
    await expect(page.getByText(/Team Members/i).first()).toBeVisible({ timeout: 20000 });
  });
});
