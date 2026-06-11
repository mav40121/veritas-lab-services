// tests/playwright/veritacheck-censored-view.spec.ts
//
// Gate 3 step 8 receipt for the censoring view-recompute fix (2026-06-11):
// StudyResultsPage RE-COMPUTES results from data_points through the numeric
// calculate* engine; a saved study with a censored ("<17") value would
// NaN-poison that recompute. deepResolveCensored resolves censored values per
// the study's policy before computing.
//
// This drives the full censoring happy-path in a real browser: enter a "<17"
// value in a Method Comparison study, save, land on the results page, and
// assert the on-screen results render WITHOUT "NaN" and show a verdict. It
// therefore also exercises the PR B data-entry path end to end.
//
// Skips unless creds are provided so it is safe in any runner:
//   PW_TOKEN  — a logged-in veritas_token
//   PW_LAB_ID — a lab the user is an active member of (e.g. San Carlos = 2)
//   PW_BASE   — defaults to https://www.veritaslabservices.com
//
// Run: PW_TOKEN=... PW_LAB_ID=2 npx playwright test veritacheck-censored-view

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";

async function auth(page: any) {
  await page.goto(`${BASE}/`);
  await page.evaluate((t: string) => localStorage.setItem("veritas_token", t), TOKEN);
}

test.describe("VeritaCheck censored study view recompute", () => {
  test("a study with a <17 value renders finite on-screen results (no NaN)", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID, "PW_TOKEN + PW_LAB_ID required");
    await auth(page);
    await page.goto(`${BASE}/labs/${LAB_ID}/study/new`);

    // Method Comparison.
    const typeSelect = page.getByTestId("select-study-type");
    await expect(typeSelect).toBeVisible({ timeout: 15000 });
    await typeSelect.click();
    await page.getByRole("option", { name: /Method Comparison/i }).click();

    await page.getByTestId("input-test-name").fill("co2 censored e2e");

    // Fill 5 rows: both comparison instruments per row (readiness needs >=2
    // instrument values per row), with row 0's first comparison value censored.
    const rowVals = [
      { a: "<17", b: "24" },
      { a: "100", b: "101" },
      { a: "250", b: "248" },
      { a: "60", b: "59" },
      { a: "180", b: "182" },
    ];
    for (let i = 0; i < rowVals.length; i++) {
      const expected = page.getByTestId(`input-dp-expected-${i}`);
      if (await expected.count()) await expected.fill(String(40 + i * 30));
      await page.getByTestId(`input-dp-value-${i}-1`).fill(rowVals[i].a);
      await page.getByTestId(`input-dp-value-${i}-2`).fill(rowVals[i].b);
    }

    // The censored cell echoes its marker back.
    await expect(page.getByTestId("input-dp-value-0-1")).toHaveValue("<17");

    const submit = page.getByTestId("button-submit-study");
    await expect(submit).toBeEnabled({ timeout: 10000 });
    await submit.click();

    // Lands on the results page and recomputes finite stats.
    await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("NaN");
    // A pass/fail verdict should render (proves the recompute produced numbers).
    await expect(page.getByText(/PASS|FAIL/i).first()).toBeVisible({ timeout: 15000 });
  });
});
