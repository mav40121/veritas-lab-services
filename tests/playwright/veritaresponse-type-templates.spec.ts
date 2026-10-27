// tests/playwright/veritaresponse-type-templates.spec.ts
//
// Gate 3 step 8 receipt for the VeritaResponse entry-type templates (Michael 2026-10-26, mock D1-D7). Drives the real
// pages: a PT failure opened from the New Finding dialog (no accreditor, PT evaluation received date) shows its own
// title, single-event status, investigation checklist and PT prompts; a checklist answer survives a save and reload;
// Closed is not offered in the status list and the sign-off button is there; a VeritaQC escalation opens as a
// "QC Event" with the look-back questions and the 30-day target, not a CMS-2567 card, and its QC event report
// downloads once the look-back and corrective action are filled in.
//
// Seeds its own made-up account, lab and QC run through the API, so it runs ONLY against a local build on a throwaway
// database (never production): PW_BASE must be a localhost address and PW_ADMIN_SECRET the local server's test admin
// secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test veritaresponse-type-templates

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("each VeritaResponse entry type opens on its own template", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-types-${Date.now()}@example.com`;
  const password = ["Pw", "types", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW Types Owner", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json()).labId);
  const token = reg.token as string; // the registration's own session (a second sign-in would meet the one-session rule)
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const headers = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) };
  const api = async (path: string, data: any) => {
    const r = await request.post(`${BASE}/api/labs/${labId}${path}`, { headers, data });
    const body = await r.json().catch(() => ({}));
    expect(r.ok(), `${path} ${r.status()} ${JSON.stringify(body)}`).toBeTruthy();
    return body;
  };

  await page.setViewportSize({ width: 1280, height: 900 });
  await injectAuth(page, BASE, token);

  // PT failure from the dialog.
  await page.goto(`${BASE}/labs/${labId}/veritaresponse`);
  await page.getByRole("button", { name: /New Finding/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "PT failure" }).click();
  await expect(dialog.getByText("Accreditor", { exact: true })).toHaveCount(0);
  await dialog.getByPlaceholder("e.g. CAP, API, AAB").fill("CAP");
  await dialog.getByPlaceholder("e.g. 2026 C-A").fill("2026-B");
  await dialog.getByPlaceholder("e.g. Glucose").fill("Glucose");
  await dialog.getByPlaceholder("e.g. 60% (3/5)").fill("60% (3/5)");
  await dialog.getByTestId("pt-eval-received").fill("2026-10-01");
  await dialog.getByRole("button", { name: /Create|Log/ }).last().click();
  await expect(dialog).toBeHidden({ timeout: 15000 });
  await page.getByText("PT failure", { exact: true }).first().click();
  await expect(page.getByRole("heading", { name: /^PT Failure #\d+$/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText("42 CFR 493.1236(a) and (d): proficiency testing results are evaluated and documented")).toBeVisible();
  await expect(page.getByTestId("pt-event-status")).toContainText("Below the 80 percent passing score");
  await expect(page.getByTestId("finding-target-date")).toHaveText("2026-10-31");
  await expect(page.getByTestId("finding-type-details")).toContainText("PT investigation");
  await expect(page.getByText("Tested like a patient specimen (42 CFR 493.801(b))")).toBeVisible();
  await page.getByTestId("detail-pt_checklist-clerical").click();
  await page.getByRole("option", { name: "Yes" }).click();
  const [saved] = await Promise.all([
    page.waitForResponse((r) => /\/findings\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT"),
    page.getByRole("button", { name: /^Save$/ }).click(),
  ]);
  expect(saved.ok(), `save ${saved.status()}`).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId("detail-pt_checklist-clerical")).toContainText("Yes", { timeout: 20000 });
  await page.getByTestId("finding-status").click();
  await expect(page.getByRole("option", { name: "Closed" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  // BUG-080 (2026-10-27): the button names how this user signs; the seeded user is the lab owner (logged override).
  await expect(page.getByTestId("finding-signoff-btn")).toHaveText("Sign off and close (owner override)");
  await page.getByTestId("finding-type-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/vr-type-pt.png" });

  // QC escalation.
  const lot = await api("/qc/control-lots", { analyte: "PW Potassium", level: "Level 2", lot_number: "PWT-2", mfr_mean: 5, mfr_sd: 0.1 });
  const run = await api("/qc/results", { control_lot_id: lot.lot.id, result_value: 5.4, result_date: "2026-10-20", instrument: "Analyzer A" });
  const ca = await api("/qc/corrective-actions", { qc_result_id: run.result_id, action_taken: "Reran Level 2 with a new vial" });
  const esc = await api(`/qc/corrective-actions/${ca.corrective_action_id}/escalate-to-response`, {});
  await page.goto(`${BASE}/labs/${labId}/veritaresponse/${esc.finding_id}`);
  await expect(page.getByRole("heading", { name: /^QC Event QC-/ })).toBeVisible({ timeout: 20000 });
  await expect(page.getByTestId("finding-type-details")).toContainText("QC investigation and patient look-back");
  await expect(page.getByText("Patient results evaluated")).toBeVisible();
  await expect(page.getByText("CMS-2567 Plan of Correction")).toHaveCount(0);
  await expect(page.getByText(/All patient test results obtained in the unacceptable test run/).first()).toBeVisible();
  await page.getByTestId("finding-type-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/vr-type-qc.png" });

  // The QC event report (mock D7): refused with what is missing, then generated once the look-back and corrective
  // action are in.
  await page.getByTestId("type-report-btn").click();
  await expect(page.getByTestId("type-report-error")).toContainText("Patient look-back", { timeout: 15000 });
  await page.getByTestId("detail-lookback_results").fill("38");
  await page.getByPlaceholder("What changed: new control vial, recalibration, reagent lot, maintenance.").fill("Vial discarded; open-vial dating added to the rack.");
  const [qcSaved] = await Promise.all([
    page.waitForResponse((r) => /\/findings\/\d+$/.test(new URL(r.url()).pathname) && r.request().method() === "PUT"),
    page.getByRole("button", { name: /^Save$/ }).click(),
  ]);
  expect(qcSaved.ok(), `save ${qcSaved.status()}`).toBeTruthy();
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByTestId("type-report-btn").click()]);
  expect(download.suggestedFilename()).toMatch(/^QC-Event_QC-.*\.pdf$/);
  await download.saveAs("test-results/vr-qc-event-report.pdf");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("finding-type-details")).toBeVisible({ timeout: 20000 });
  await page.getByTestId("finding-type-details").scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/vr-type-qc-dark.png" });
});
