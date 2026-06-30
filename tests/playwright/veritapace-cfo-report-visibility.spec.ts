// tests/playwright/veritapace-cfo-report-visibility.spec.ts
//
// Regression for the CFO report button visibility fix (PR #889). The button was
// disabled (and faint) unless a goal+volume was typed live, so on a lab that has a
// saved staffing grid but no typed goal (e.g. Michaels Lab) the button looked absent.
// The fix shows the button whenever there is reportable data: a typed goal+volume OR
// a saved staffing grid (fcResult || fcStaffFromGrid), and drops the disabled-when-empty
// state so it never renders as a ghost.
//
// This spec asserts the button is VISIBLE on the Forecast from Goal card WITHOUT typing
// a goal first, which is exactly the grid-only / no-typed-goal path the fix restores.
// Requires PW_TOKEN (owner JWT whose primary lab carries a staffing grid) and skips
// otherwise so it stays green in the compile-only CI gate.
//
// Env: PW_BASE (default production www), PW_TOKEN (owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaPace: CFO report button visibility (grid-only, no typed goal)", () => {
  test("CFO report button is visible without typing a goal first", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-time gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/veritabench`);
    await expect(page.locator("body")).toContainText("Forecast from Goal");
    // Do NOT fill the goal/volume inputs. Pre-fix this left fcResult null and the button
    // hidden/disabled; post-fix the saved staffing grid keeps it visible.
    await expect(page.getByRole("button", { name: /CFO report/i })).toBeVisible();
  });
});
