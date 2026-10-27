// tests/playwright/qc-cosign-designee.spec.ts
//
// Gate 3 step 8 for BUG-077 (2026-10-27): on VeritaQC > Daily Review, a technical supervisor holding a Letter of
// Delegation with the QC co-sign responsibility now sees "Co-sign as designee" on a filed monthly review (the button
// used to show only to the designated medical director), clicks it, and the review reads co-signed "(designee)".
//
// Runs ONLY against a local build on a throwaway database: PW_BASE localhost, PW_ADMIN_SECRET the local test secret,
// SCRATCH_DB the local server's DB file (the member, seat and letter rows are written straight into it).
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret SCRATCH_DB=<db> npx playwright test qc-cosign-designee

import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const DBFILE = process.env.SCRATCH_DB || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("a delegated technical supervisor sees and uses the QC co-sign button", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL || !DBFILE, "local build with PW_ADMIN_SECRET and SCRATCH_DB only");
  const stamp = Date.now();
  const pw = ["Pw", "qcc", "7x!"].join("-");
  const ownerEmail = `pw-qcc-owner-${stamp}@example.com`, tsEmail = `pw-qcc-ts-${stamp}@example.com`;
  const owner = await (await request.post(`${BASE}/api/auth/register`, { data: { email: ownerEmail, password: pw, name: "PW QC Owner", hipaa_acknowledged: true } })).json();
  const ts = await (await request.post(`${BASE}/api/auth/register`, { data: { email: tsEmail, password: pw, name: "PW Tech Supervisor", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json()).labId);
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${owner.token}` } });
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${ts.token}` } });

  // Made-up rows in the throwaway DB: the supervisor's membership and seat, an active letter with the QC co-sign
  // responsibility, a control lot, and the two-signature setting on.
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(DBFILE);
  const ownerId = (db.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail) as any).id;
  const tsId = (db.prepare("SELECT id FROM users WHERE email = ?").get(tsEmail) as any).id;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)").run(labId, tsId, now, now, now);
  db.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, tsId);
  db.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')")
    .run(ownerId, tsEmail, tsId, now, now, JSON.stringify({ mode: "custom", overrides: { veritaqc: "view" } }), `pw-qcc-${stamp}`, labId);
  db.prepare("INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, status, signed_at, created_at, updated_at) VALUES (?, ?, 'PW Tech Supervisor', 'technical_supervisor', 'high', ?, 'active', ?, ?, ?)")
    .run(labId, tsId, JSON.stringify({ qc_period_cosign: true }), now, now, now);
  const lotId = Number(db.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd) VALUES (?, 'Glucose', 'mid', 'PW-LOT-1', 100, 3)").run(labId).lastInsertRowid);
  db.prepare("UPDATE labs SET qc_md_cosign_required = 1 WHERE id = ?").run(labId);
  db.close();

  // The owner files this month's review (the page opens on the current month).
  const today = new Date();
  const filed = await request.post(`${BASE}/api/labs/${labId}/qc/period-reviews`, {
    headers: { Authorization: `Bearer ${owner.token}`, "X-Active-Lab-Id": String(labId) },
    data: { control_lot_id: lotId, period_year: today.getFullYear(), period_month: today.getMonth() + 1, attestation_acknowledged: true },
  });
  expect(filed.status()).toBe(200);

  await page.setViewportSize({ width: 1400, height: 900 });
  await injectAuth(page, BASE, ts.token);
  await page.goto(`${BASE}/labs/${labId}/veritaqc-app/review`);
  const btn = page.getByTestId("qc-cosign-button");
  await expect(btn).toBeVisible({ timeout: 30000 });
  await expect(btn).toHaveText("Co-sign as designee");
  await btn.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/qc-cosign-designee-button.png" });
  await btn.click();
  await expect(page.getByText(/Medical Director co-signed by PW Tech Supervisor \(designee\)/)).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: "test-results/qc-cosign-designee-signed.png" });
});
