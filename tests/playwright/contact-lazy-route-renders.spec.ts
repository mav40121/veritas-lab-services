// tests/playwright/contact-lazy-route-renders.spec.ts
//
// Gate 3 step 8 + regression guard for the lazy-chunk self-heal hardening
// (client/src/lib/lazyChunk.ts + App.tsx). A stale chunk after a deploy could drop
// a lazy route like /contact into the ErrorBoundary ("Something went wrong" /
// "An unexpected error occurred"), reported by Michael on a logged-out /contact
// visit. This asserts /contact and other lazy routes resolve their chunk through
// lazyWithReload, render real content, and never show the error boundary.
//
// Run: npx playwright test contact-lazy-route-renders
//      PW_BASE=http://127.0.0.1:4173 npx playwright test contact-lazy-route-renders

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ROUTES = ["/contact", "/pricing", "/resources/laboratory-inventory-management"];

test.describe("lazy routes render without the error boundary", () => {
  for (const path of ROUTES) {
    test(`${path} renders content, no error boundary`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const text = (await page.locator("body").innerText()).trim();
      // A resolved lazy route renders real content; a stuck one is near-empty.
      expect(text.length).toBeGreaterThan(150);
      // The ErrorBoundary fallback must not be showing.
      expect(text).not.toContain("Something went wrong");
      expect(text).not.toContain("An unexpected error occurred");
      expect(errors, errors.join(" | ")).toEqual([]);
    });
  }

  test("/contact renders its form heading (the reported route)", async ({ page }) => {
    await page.goto(`${BASE}/contact`, { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText("Tell Us About Your Needs");
  });
});
