// tests/playwright/navbar-host-skin.spec.ts
//
// Gate 3 receipt for the host-aware NavBar chrome (client/src/components/NavBar.tsx).
// The skin keys on the served hostname, so the assertion forks on PW_BASE:
//   - default lab host (veritaslabservices.com): the lab-compliance brand
//     tagline must still render (proves the host-skin did NOT break the default).
//   - a veritastock.com host: the VeritaStock inventory tagline renders and the
//     lab-compliance tagline is gone.
//
// Run default:  PW_BASE=https://www.veritaslabservices.com npx playwright test navbar-host-skin
// Run skin:     PW_BASE=https://www.veritastock.com        npx playwright test navbar-host-skin

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const isStockHost = /veritastock\.com/i.test(BASE);

test.describe("NavBar host-aware chrome", () => {
  test("brand and nav match the served host", async ({ page }) => {
    await page.goto(`${BASE}/`);
    if (isStockHost) {
      await expect(page.getByText(/Multi-Location Inventory/i).first()).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Clinical Laboratory Consulting/i)).toHaveCount(0);
      // Root route serves the VeritaStock landing, not the lab homepage.
      await expect(page.getByRole("heading", { name: /Know what you have, everywhere/i })).toBeVisible();
      await expect(page.getByText(/Nobody taught you the compliance/i)).toHaveCount(0);
      // Footer is the minimal VeritaStock footer, not the lab-services footer.
      await expect(page.getByText(/Leadership Coaching/i)).toHaveCount(0);
      await expect(page.getByText(/Multi-Location Inventory/i).first()).toBeVisible();
      // Logged out: no inventory nav links (they are gated on isLoggedIn), so a
      // public visitor sees only the brand + landing CTAs, never a lab-scoped link.
      await expect(page.getByRole("link", { name: /^All Locations$/i })).toHaveCount(0);
    } else {
      // Default lab host stays the full compliance chrome.
      await expect(page.getByText(/Clinical Laboratory Consulting/i).first()).toBeVisible({ timeout: 15000 });
    }
  });

  // Regression guard for the 2026-06-19 "complete failure" report: logging in on
  // veritastock.com dropped the user on the VeritaCheck dashboard with a navbar
  // that had no links — a dead end. Post-login must land in VeritaStock and the
  // navbar must expose Inventory + All Locations. Needs a real token (PW_TOKEN)
  // and the stock host (PW_BASE=https://www.veritastock.com).
  test("logged-in stock host has VeritaStock nav and lands in inventory", async ({ page }) => {
    test.skip(!isStockHost, "stock-host only");
    test.skip(!process.env.PW_TOKEN, "needs PW_TOKEN to exercise the authed nav");
    await injectAuth(page, BASE, process.env.PW_TOKEN as string);
    await page.goto(`${BASE}/login`);
    // The nav links are lab-scoped (/labs/:id/veritastock[/enterprise]).
    const inventory = page.getByRole("link", { name: /^Inventory$/i }).first();
    const allLocations = page.getByRole("link", { name: /^All Locations$/i }).first();
    await expect(inventory).toBeVisible({ timeout: 15000 });
    await expect(allLocations).toBeVisible();
    await expect(inventory).toHaveAttribute("href", /\/labs\/\d+\/veritastock$/);
    await expect(allLocations).toHaveAttribute("href", /\/labs\/\d+\/veritastock\/enterprise$/);
  });
});
