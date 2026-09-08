// tests/playwright/funnel-url-aliases.spec.ts
//
// Conversion-funnel guard: conventional URLs a prospect types or an ad / email /
// social link uses must NOT land on the 404 page. Each alias below previously
// fell through to <NotFound/> (a silent first-touch funnel leak); App.tsx now
// redirects them to a real page. This asserts each alias resolves to its intended
// destination and never renders "404 Page Not Found".
//
// Runs against prod by default (public pages, no auth). Env: PW_BASE.

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const ALIASES: Array<[string, string]> = [
  ["/signup", "/register"],
  ["/sign-up", "/register"],
  ["/free-trial", "/register"],
  ["/trial", "/register"],
  ["/get-started", "/getting-started"],
  ["/start", "/getting-started"],
  ["/request-demo", "/book"],
  ["/book-a-demo", "/book"],
  ["/schedule", "/book"],
  ["/features", "/veritaassure"],
  ["/product", "/veritaassure"],
  ["/about", "/team"],
];

test.describe("Conversion funnel — conventional URL aliases redirect, never 404", () => {
  for (const [alias, dest] of ALIASES) {
    test(`${alias} -> ${dest} (no 404)`, async ({ page }) => {
      await page.goto(`${BASE}${alias}`, { waitUntil: "domcontentloaded" });
      // Wait for the SPA redirect to settle.
      await page.waitForTimeout(1500);
      const path = new URL(page.url()).pathname.replace(/\/$/, "") || "/";
      expect(path, `${alias} should redirect to ${dest}`).toBe(dest);
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body, `${alias} must not render the 404 page`).not.toContain("404 page not found");
    });
  }
});
