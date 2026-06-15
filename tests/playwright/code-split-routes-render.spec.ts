// tests/playwright/code-split-routes-render.spec.ts
//
// Regression guard for the 2026-06-14 route-based code-splitting refactor
// (App.tsx: 88 page components converted to React.lazy behind Suspense
// boundaries; vite manualChunks isolates recharts/exceljs/jspdf). The failure
// this guards against: a lazy route whose dynamic import or Suspense boundary
// breaks renders a permanent blank spinner instead of the page. It asserts a
// spread of public routes across BOTH route syntaxes used in App.tsx
// (`component={}` and the `wrapLegacy` children-render form) actually resolve
// their lazy chunk, render content, and throw no uncaught page error.
//
// This is also the Gate 3 step 8 browser exercise for the App.tsx change. It
// mirrors the manual 50-route sweep run on the production build before merge
// (homepage JS dropped 1148 KB -> 283 KB gzip with every public route still
// rendering clean).
//
// Run: npx playwright test code-split-routes-render
//      PW_BASE=http://127.0.0.1:4173 npx playwright test code-split-routes-render

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

const ROUTES = [
  "/",                              // HomePage (kept eager) — landing path
  "/pricing",                       // marketing, component={}
  "/veritaassure",                  // marketing, component={}
  "/faq",                           // marketing, component={}
  "/resources/clia-tea-lookup",     // data-heavy lazy page
  "/veritacheck",                   // wrapLegacy children-render route
];

test.describe("code-split: lazy public routes resolve and render", () => {
  for (const path of ROUTES) {
    test(`${path} resolves its chunk and renders (no Suspense-stuck blank, no page error)`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      // A lazy route that never resolves leaves only the spinner fallback,
      // so the body would be near-empty. Real content means Suspense resolved.
      const text = (await page.locator("body").innerText()).trim();
      expect(text.length).toBeGreaterThan(150);
      expect(errors, errors.join(" | ")).toEqual([]);
    });
  }
});
