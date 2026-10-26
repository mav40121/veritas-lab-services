// tests/playwright/qc-void-finding.spec.ts
//
// Gate 3 step 8 receipt for parking lot #100 (2026-10-26): voiding a QC run in VeritaQC settles the VeritaResponse
// finding escalated from it. Drives the real browser flow: void the run from the results table (reason prompt), see
// the toast say the worked finding was flagged, then open the finding and see the "QC run voided" banner.
//
// Seeds its own made-up account, lab, control lot, run, corrective action and finding through the API, so it runs
// ONLY against a local build on a throwaway database (never production): PW_BASE must be a localhost address and
// PW_ADMIN_SECRET the local server's test admin secret.
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret npx playwright test qc-void-finding

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("voiding a QC run flags its worked finding, and the finding shows the QC run voided banner", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL, "seeds its own data: local build with PW_ADMIN_SECRET only");
  const email = `pw-qcvoid-${Date.now()}@example.com`;
  const password = ["Pw", "qcvoid", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW QC Owner", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "PW QC Void Lab", plan: "hospital" } })).json()).labId);
  const token = reg.token as string; // the registration's own session (a second sign-in would meet the one-session rule)
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const headers = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) };
  const api = async (path: string, data: any, method: "post" | "put" = "post") => {
    const r = await request[method](`${BASE}/api/labs/${labId}${path}`, { headers, data });
    const body = await r.json().catch(() => ({}));
    expect(r.ok(), `${method.toUpperCase()} ${path} ${r.status()} ${JSON.stringify(body)}`).toBeTruthy();
    return body;
  };

  const lot = await api("/qc/control-lots", { analyte: "PW Glucose", level: "Level 1", lot_number: "PWV-1", mfr_mean: 100, mfr_sd: 3 });
  const run = await api("/qc/results", { control_lot_id: lot.lot.id, result_value: 109, result_date: "2026-10-20", instrument: "Analyzer A" });
  const ca = await api("/qc/corrective-actions", { qc_result_id: run.result_id, action_taken: "Reran control, in range" });
  const esc = await api(`/qc/corrective-actions/${ca.corrective_action_id}/escalate-to-response`, {});
  // Work on the finding (a root cause), so voiding the run flags it instead of closing it.
  await api(`/findings/${esc.finding_id}`, { ...esc.finding, root_cause: "Control vial left at room temperature" }, "put");

  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/labs/${labId}/veritaqc-app`);
  const voidButton = page.getByTitle(/^Void this result/).first();
  await expect(voidButton).toBeVisible({ timeout: 20000 });
  page.once("dialog", (d) => d.accept("Wrong lot scanned"));
  await voidButton.click();
  await expect(page.getByText(/flagged "QC run voided" for review instead of closed/).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Voided", { exact: true }).first()).toBeVisible();

  await page.goto(`${BASE}/labs/${labId}/veritaresponse/${esc.finding_id}`);
  const banner = page.getByTestId("finding-qc-run-voided");
  await expect(banner).toBeVisible({ timeout: 20000 });
  await expect(banner).toContainText("Wrong lot scanned");
  await page.screenshot({ path: "test-results/qc-void-finding-banner.png", fullPage: false });

  // The banner has its own dark-mode colors; the app follows the system theme on load.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("finding-qc-run-voided")).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: "test-results/qc-void-finding-banner-dark.png", fullPage: false });
});
