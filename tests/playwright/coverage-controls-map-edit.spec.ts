// tests/playwright/coverage-controls-map-edit.spec.ts
//
// Gate 3 step 8 for BUG-076 (2026-10-27): on VeritaCheck > Coverage, the calibration verification exemption controls
// write VeritaMap data and the server requires VeritaMap edit. A seat with VeritaCheck edit but VeritaMap view now sees
// them disabled (it used to see them enabled and get a 403); the owner still sees them enabled.
//
// Runs ONLY against a local build on a throwaway database: PW_BASE localhost, PW_ADMIN_SECRET the local test secret,
// SCRATCH_DB the local server's DB file (the seat row is written straight into it).
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret SCRATCH_DB=<db> npx playwright test coverage-controls-map-edit

import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const DBFILE = process.env.SCRATCH_DB || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("exemption controls follow VeritaMap edit, not VeritaCheck edit", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL || !DBFILE, "local build with PW_ADMIN_SECRET and SCRATCH_DB only");
  const stamp = Date.now();
  const pw = ["Pw", "cov", "7x!"].join("-");
  const ownerEmail = `pw-cov-owner-${stamp}@example.com`, seatEmail = `pw-cov-seat-${stamp}@example.com`;
  const owner = await (await request.post(`${BASE}/api/auth/register`, { data: { email: ownerEmail, password: pw, name: "PW Cov Owner", hipaa_acknowledged: true } })).json();
  const seat = await (await request.post(`${BASE}/api/auth/register`, { data: { email: seatEmail, password: pw, name: "PW Cov Seat", hipaa_acknowledged: true } })).json();
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json()).labId);
  const auth = { Authorization: `Bearer ${owner.token}`, "X-Active-Lab-Id": String(labId) };
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${owner.token}` } });
  await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${seat.token}` } });
  const map = await (await request.post(`${BASE}/api/labs/${labId}/veritamap/maps`, { headers: auth, data: { name: "PW Coverage Map" } })).json();
  const inst = await (await request.post(`${BASE}/api/labs/${labId}/veritamap/maps/${map.id}/instruments`, { headers: auth, data: { instrument_name: "Abbott ARCHITECT c4000", role: "Primary", category: "Chemistry" } })).json();
  await request.put(`${BASE}/api/labs/${labId}/veritamap/maps/${map.id}/instruments/${inst.id}/tests`, { headers: auth,
    data: { tests: ["Glucose", "Sodium"].map((analyte) => ({ analyte, specialty: "General Chemistry", complexity: "MODERATE", active: 1 })) } });

  // A staff member with an active seat: VeritaCheck edit, VeritaMap view (made-up rows in the throwaway DB).
  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(DBFILE);
  const ownerId = (db.prepare("SELECT id FROM users WHERE email = ?").get(ownerEmail) as any).id;
  const seatId = (db.prepare("SELECT id FROM users WHERE email = ?").get(seatEmail) as any).id;
  const now = new Date().toISOString();
  db.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)").run(labId, seatId, now, now, now);
  db.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, seatId);
  db.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')")
    .run(ownerId, seatEmail, seatId, now, now, JSON.stringify({ mode: "custom", overrides: { veritacheck: "edit", veritamap: "view" } }), `pw-cov-${stamp}`, labId);
  db.close();

  const firstExempt = () => page.locator("[data-testid^='cov-multical-']").first();
  await page.setViewportSize({ width: 1400, height: 900 });

  // Owner: enabled.
  await injectAuth(page, BASE, owner.token);
  await page.goto(`${BASE}/labs/${labId}/veritacheck/coverage`);
  await expect(firstExempt()).toBeVisible({ timeout: 30000 });
  await expect(firstExempt()).toBeEnabled();

  // VeritaCheck-edit / VeritaMap-view seat: disabled.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await injectAuth(page, BASE, seat.token);
  await page.goto(`${BASE}/labs/${labId}/veritacheck/coverage`);
  await expect(firstExempt()).toBeVisible({ timeout: 30000 });
  await expect(firstExempt()).toBeDisabled({ timeout: 15000 });
  await firstExempt().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/coverage-controls-map-view-seat.png" });
});
