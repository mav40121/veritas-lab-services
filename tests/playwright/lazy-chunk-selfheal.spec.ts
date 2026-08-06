// tests/playwright/lazy-chunk-selfheal.spec.ts
//
// Gate 3 evidence for the lazy-chunk self-heal (App.tsx lazy() wrapper). When a
// dynamic import() fails because the hashed chunk is gone (a deploy shipped
// while the tab was open), the wrapper forces one guarded reload instead of
// dropping the user on the "Something went wrong" error boundary. The reload
// path is hard to force from a clean page load; this spec is the regression
// guard that a lazy route (/veritaassure) renders its content and NOT the
// error boundary on a normal load.
//
// Gated on PW_BASE; compile-only in CI (no live network required there).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "";
const BOUNDARY_TEXT = "An unexpected error occurred. Please reload the page to continue.";

test.describe("lazy route renders, not the error boundary", () => {
  test("/veritaassure shows suite content, not the crash boundary", async ({ page }) => {
    if (!BASE) { test.skip(true, "Set PW_BASE to run against a deployment."); return; }
    await page.goto(`${BASE}/veritaassure`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: /VeritaAssure/i }).first()).toBeVisible();
    await expect(page.getByText(BOUNDARY_TEXT)).toHaveCount(0);
  });
});
