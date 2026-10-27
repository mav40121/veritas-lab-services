// tests/playwright/veritamap-sop-link.spec.ts
//
// Gate 3 step 8 for parking lot #93 (Michael Q86 = 1): on the VeritaMap map page a test's SOP Review cell offers
// "Link policy"; the dialog searches the lab's VeritaDC policies, can add every test in the same specialty, and after
// linking the cell shows the policy title, "Current" and its last review date.
//
// Runs ONLY against a local build on a throwaway database (never production): PW_BASE must be a localhost address,
// PW_ADMIN_SECRET the local server's test admin secret, and SCRATCH_DB the local server's DB file (the made-up approved
// policy is written straight into it; uploading a real file is not what this receipt checks).
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret SCRATCH_DB=<db> npx playwright test veritamap-sop-link

import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const DBFILE = process.env.SCRATCH_DB || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("link a test's SOP to a VeritaDC policy", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL || !DBFILE, "local build with PW_ADMIN_SECRET and SCRATCH_DB only");
  const email = `pw-sop-${Date.now()}@example.com`;
  const password = ["Pw", "sop", "7x!"].join("-");
  const reg = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password, name: "PW SOP Owner", hipaa_acknowledged: true } })).json();
  const prov = await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json();
  const labId = Number(prov.labId);
  const token = reg.token as string;
  const auth = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) };
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${token}` } });
  const map = await (await request.post(`${BASE}/api/labs/${labId}/veritamap/maps`, { headers: auth, data: { name: "PW SOP Map" } })).json();
  const inst = await (await request.post(`${BASE}/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { headers: auth, data: { instrument_name: "Abbott ARCHITECT c4000", role: "Primary", category: "Chemistry" } })).json();
  await request.put(`${BASE}/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${inst.id}/tests`, { headers: auth,
    data: { tests: ["Glucose", "Sodium", "Potassium"].map((analyte) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1 })) } });

  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(DBFILE);
  const userId = (db.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id;
  const now = new Date().toISOString();
  const docId = Number(db.prepare("INSERT INTO policy_documents (lab_id, title, owner_user_id, status, next_review_date, created_at, updated_at) VALUES (?, 'Chemistry Analyzer Procedure', ?, 'approved', '2028-06-01', ?, ?)").run(labId, userId, now, now).lastInsertRowid);
  db.prepare("INSERT INTO policy_signoffs (document_id, version_id, user_id, action, typed_signature, signed_document_hash, signed_at) VALUES (?, 0, ?, 'approved', 'Made-Up Signer', 'x', '2026-06-01 15:30:00')").run(docId, userId);
  db.close();

  await page.setViewportSize({ width: 1400, height: 900 });
  await injectAuth(page, BASE, token);
  await page.goto(`${BASE}/labs/${labId}/veritamap-app/${map.id}`);
  const cell = page.getByTestId("sop-cell-Glucose");
  await expect(cell).toBeVisible({ timeout: 30000 });
  await cell.getByTestId("sop-link-open").click();
  await page.getByTestId("sop-link-search").fill("analyzer");
  await page.getByTestId(`sop-link-doc-${docId}`).click();
  await page.getByTestId("sop-link-specialty").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/veritamap-sop-link-dialog.png" });
  await page.getByTestId("sop-link-save").click();

  for (const a of ["Glucose", "Sodium", "Potassium"]) {
    const c = page.getByTestId(`sop-cell-${a}`);
    await expect(c.getByTestId("sop-link-title")).toHaveText("Chemistry Analyzer Procedure", { timeout: 15000 });
    await expect(c.getByTestId("sop-link-chip")).toHaveText("Current");
  }
  await expect(page.getByTestId("sop-cell-Glucose")).toContainText("Reviewed 2026-06-01");
  await page.getByTestId("sop-cell-Glucose").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/veritamap-sop-link-cells.png" });

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByTestId("sop-cell-Glucose").getByTestId("sop-link-chip")).toHaveText("Current", { timeout: 30000 });
  await page.getByTestId("sop-cell-Glucose").scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/veritamap-sop-link-dark.png" });
});
