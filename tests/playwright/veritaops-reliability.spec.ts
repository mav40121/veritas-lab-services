// tests/playwright/veritaops-reliability.spec.ts
//
// Gate 3 step-8 evidence for the VeritaOps client reliability fixes (audit
// MED #3 error-as-empty, MED #4 PDF-popup false-success, LOW #6 delete).
//
//   #3  A failed studies-list load used to render the "No CPRT studies yet"
//       empty state as if the lab had none. This forces the list to 500 and
//       asserts the distinct "Couldn't load studies" error card + Retry.
//   #4  The PDF button toasted "PDF generated" even when the browser blocked
//       the popup (window.open returned null). This stubs window.open to null
//       and asserts the honest "Popup blocked" toast, NOT a success toast.
//
// Needs PW_TOKEN (an ops-qualifying account); skips otherwise (compile-only
// gate run in CI, which still satisfies gate3-ui-evidence).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

const FAKE_STUDY = {
  id: 999001,
  test_name: "QA Popup Potassium",
  loinc: null,
  department: "Chemistry",
  annual_volume: 50000,
  reagent_cost_per_test: 0.3,
  calibrator_kit_cost: 0, cals_per_year: 0, qc_cost_per_run: 0, qc_runs_per_year: 0,
  other_supplies_per_test: 0, tech_minutes_per_test: 0, tech_loaded_hourly_rate: 0,
  include_capital: 0, instrument_purchase_cost: 0, instrument_useful_life_years: 7,
  annual_maintenance_cost: 0, include_overhead: 0, overhead_method: "flat", overhead_value: 0,
  cprt_l1: 0.3, cprt_l2: 0.3, cprt_l3: 0.3, cprt_l4: 0.3,
  notes: null, created_at: "2026-07-31T00:00:00Z", updated_at: "2026-07-31T00:00:00Z",
};

test.describe("VeritaOps reliability", () => {
  test("#3 a 500 on the studies list shows the error card, not the empty state", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    await page.route(/\/veritaops\/studies(\?.*)?$/, (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "forced" }) })
    );

    await page.goto(`${BASE}/veritaops-app`, { waitUntil: "networkidle" });

    await expect(page.getByText(/Couldn't load studies/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
    await expect(page.getByText(/No CPRT studies yet/i)).toHaveCount(0);
  });

  test("#4 a blocked PDF popup toasts 'Popup blocked', not a false success", async ({ page }) => {
    if (!TOKEN) { test.skip(true, "No PW_TOKEN (compile-only gate run)."); return; }
    await injectAuth(page, BASE, TOKEN);

    // The list returns exactly one study so a PDF button renders.
    await page.route(/\/veritaops\/studies(\?.*)?$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([FAKE_STUDY]) })
    );
    // The PDF token POST succeeds, so the only remaining failure is the popup.
    await page.route(/\/veritaops\/studies\/\d+\/pdf$/, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "faketok", filename: "x.pdf" }) })
    );
    // Simulate a browser popup blocker: window.open yields null.
    await page.addInitScript(() => { (window as any).open = () => null; });

    await page.goto(`${BASE}/veritaops-app`, { waitUntil: "networkidle" });
    await expect(page.getByTestId("cprt-row-999001")).toBeVisible({ timeout: 10000 });

    await page.getByTestId("pdf-cprt-999001").click();

    await expect(page.getByText(/Popup blocked/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/PDF generated/i)).toHaveCount(0);
  });
});
