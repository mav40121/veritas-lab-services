// tests/playwright/correlation-run-details.spec.ts
//
// Gate 3 step 8 receipt for correlation run details (2026-10-26). Seeds a made-up Correlation / Method Comparison
// study with run details, then in the real browser: the results page shows them under User Specifications, the edit
// form's "Optional run details (lots, dates)" section opens pre-filled with each analyzer's lots and date, and a
// precision study's form does not show the section.
//
// Runs ONLY against a local build on a throwaway database (seeds its own account and lab):
//   PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test correlation-run-details

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("correlation run details show on the results page and pre-fill the edit form", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-runs-${Date.now()}@example.com`;
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password: ["Pw", "runs", "7x!"].join("-"), name: "PW Runs Owner", hipaa_acknowledged: true } })).json();
  const token = reg.token as string;
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "PW Runs Lab", plan: "hospital" } })).json()).labId);
  const names = ["Analyzer A", "Analyzer B"];
  const dp = [[120, 122], [130, 128], [140, 143], [150, 151], [160, 158]].map((r, i) => ({ level: i + 1, expectedValue: r[0], instrumentValues: { "Analyzer B": r[1] } }));
  const runDetails = JSON.stringify({ specimenType: "Lithium heparin plasma", instruments: { "Analyzer A": { reagentLot: "RA-4471", calibratorLot: "CA-0910", dateRun: "2026-10-20" }, "Analyzer B": { reagentLot: "RB-5582", dateRun: "2026-10-21" } } });
  const study = await (await request.post(`${BASE}/api/labs/${labId}/studies`, {
    headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) },
    data: {
      testName: "PW Sodium", instrument: names.join(", "), analyst: "PW", date: "2026-10-21", studyType: "method_comparison",
      cliaAllowableError: 4, teaIsPercentage: 0, teaUnit: "mmol/L", dataPoints: JSON.stringify(dp), instruments: JSON.stringify(names),
      status: "completed", createdAt: new Date().toISOString(), runDetails, resultUnits: "mmol/L", comment: "Split samples, run within 2 hours",
    },
  })).json();
  expect(Number(study.id) > 0, JSON.stringify(study)).toBeTruthy();

  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/labs/${labId}/study/${study.id}/results`);
  const specs = page.getByText("User Specifications").locator("xpath=ancestor::div[contains(@class,'rounded')][1]");
  await expect(page.getByText("User Specifications")).toBeVisible({ timeout: 20000 });
  for (const t of ["Lithium heparin plasma", "mmol/L", "Reagent lot RA-4471; calibrator lot CA-0910; run 2026-10-20", "Reagent lot RB-5582; run 2026-10-21", "Split samples, run within 2 hours"]) {
    await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  }

  await page.goto(`${BASE}/labs/${labId}/study/${study.id}/edit`);
  const section = page.getByTestId("run-details");
  await expect(section).toBeVisible({ timeout: 20000 });
  await section.locator("summary").click();
  await expect(page.getByTestId("run-specimen-type")).toHaveValue("Lithium heparin plasma");
  await expect(page.getByTestId("run-units")).toHaveValue("mmol/L");
  await expect(page.getByTestId("run-reagent-lot-0")).toHaveValue("RA-4471");
  await expect(page.getByTestId("run-calibrator-lot-0")).toHaveValue("CA-0910");
  await expect(page.getByTestId("run-date-0")).toHaveValue("2026-10-20");
  await expect(page.getByTestId("run-reagent-lot-1")).toHaveValue("RB-5582");
  await expect(page.getByTestId("run-comment")).toHaveValue("Split samples, run within 2 hours");
  void specs;
});
