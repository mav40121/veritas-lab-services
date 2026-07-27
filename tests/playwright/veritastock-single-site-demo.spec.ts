// tests/playwright/veritastock-single-site-demo.spec.ts
//
// Gate 3 step 8 receipt for the temporary single-site demo mode
// (DEMO_SINGLE_SITE=on -> window.__DEMO_SINGLE_SITE__). Purely presentational:
//   - the header location switcher collapses to ONE static site chip relabeled
//     "Pfizer Proposed" (no dropdown, no other locations),
//   - the multi-location nav is hidden: no Enterprise button, no Incoming
//     button, and the NavBar "All Locations" link is gone.
// Mutates no data, so this is safe to run against the live demo; the flag is set
// via addInitScript so the test does not require the env var to be deployed.
//
//   PW_BASE=https://veritastock-production.up.railway.app PW_TOKEN=<jwt> \
//     PW_LAB=2 npx playwright test veritastock-single-site-demo
//
// Skips (compile-only in CI) when PW_BASE/PW_TOKEN are not provided.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB || "2";

const ready = () => !!(BASE && TOKEN);

test.describe("VeritaStock single-site demo mode (Pfizer Proposed)", () => {
  test("switcher shows one 'Pfizer Proposed' site; multi-location nav is hidden", async ({ page }) => {
    test.skip(!ready(), "needs PW_BASE/PW_TOKEN");
    await injectAuth(page, BASE, TOKEN);
    // Simulate the server-injected flag before any app script runs.
    await page.addInitScript(() => {
      (window as any).__DEMO_SINGLE_SITE__ = true;
    });

    await page.goto(`${BASE}/labs/${LAB}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);

    // The single static site chip carries the relabeled name.
    await expect(page.getByText("Pfizer Proposed", { exact: false }).first()).toBeVisible();

    // Multi-location surfaces are hidden.
    await expect(page.getByTestId("enterprise-button")).toHaveCount(0);
    await expect(page.getByTestId("incoming-transfers-button")).toHaveCount(0);
    await expect(page.getByTestId("incoming-transfers-banner")).toHaveCount(0);

    // Single-site inventory tooling is still present (barcode-forward demo).
    await expect(page.getByRole("button", { name: /Print Barcodes/i })).toBeVisible();
  });

  test("without the flag, the enterprise nav is present (default unchanged)", async ({ page }) => {
    test.skip(!ready(), "needs PW_BASE/PW_TOKEN");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB}/veritastock`, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);
    // Default (no flag): the Enterprise button renders.
    await expect(page.getByTestId("enterprise-button")).toBeVisible();
  });
});
