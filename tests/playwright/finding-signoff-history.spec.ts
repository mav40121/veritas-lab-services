// tests/playwright/finding-signoff-history.spec.ts
//
// Gate 3 step 8 for BUG-080 (2026-10-27), VeritaResponse finding page:
//   - the designated medical director on a VIEW-only VeritaResponse seat sees "Sign off and close as medical director"
//     (it used to be disabled for read-only seats and shown to everyone else), signs, and the new History card shows it;
//   - a staff member with no delegation sees the History card but no sign-off button.
//
// Runs ONLY against a local build on a throwaway database: PW_BASE localhost, PW_ADMIN_SECRET the local test secret,
// SCRATCH_DB the local server's DB file (member, seat and medical-director rows are written straight into it).
//
// Run: PW_BASE=http://localhost:5099 PW_ADMIN_SECRET=test-admin-secret SCRATCH_DB=<db> npx playwright test finding-signoff-history

import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const ADMIN = process.env.PW_ADMIN_SECRET || "";
const DBFILE = process.env.SCRATCH_DB || "";
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE);

test("finding sign-off follows the server rule and the history shows", async ({ page, request }) => {
  test.skip(!ADMIN || !LOCAL || !DBFILE, "local build with PW_ADMIN_SECRET and SCRATCH_DB only");
  const stamp = Date.now();
  const pw = ["Pw", "fsh", "7x!"].join("-");
  const reg = async (tag: string, name: string) => {
    const email = `pw-fsh-${tag}-${stamp}@example.com`;
    const r = await (await request.post(`${BASE}/api/auth/register`, { data: { email, password: pw, name, hipaa_acknowledged: true } })).json();
    await request.post(`${BASE}/api/auth/complete-onboarding`, { headers: { Authorization: `Bearer ${r.token}` } });
    return { email, token: r.token as string };
  };
  const owner = await reg("owner", "PW Owner"), md = await reg("md", "PW Medical Director"), staff = await reg("staff", "PW Staff");
  const labId = Number((await (await request.post(`${BASE}/api/admin/provision-demo-lab`, { data: { secret: ADMIN, ownerEmail: owner.email, labName: "Riverside Regional Medical Center", plan: "hospital" } })).json()).labId);

  const Database = createRequire(import.meta.url)("better-sqlite3");
  const db = new Database(DBFILE);
  const idOf = (e: string) => (db.prepare("SELECT id FROM users WHERE email = ?").get(e) as any).id;
  const ownerId = idOf(owner.email);
  const now = new Date().toISOString();
  for (const u of [md, staff]) {
    const uid = idOf(u.email);
    db.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)").run(labId, uid, now, now, now);
    db.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(labId, uid);
    db.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')")
      .run(ownerId, u.email, uid, now, now, JSON.stringify({ mode: "custom", overrides: { veritaresponse: "view" } }), `pw-fsh-${uid}-${stamp}`, labId);
  }
  db.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(md.email, labId);
  db.close();

  const hdr = { Authorization: `Bearer ${owner.token}`, "X-Active-Lab-Id": String(labId) };
  const f = await (await request.post(`${BASE}/api/labs/${labId}/findings`, { headers: hdr, data: { accreditor: "CMS", description: "PW made-up finding", anchor_date: "2026-10-01" } })).json();
  await request.put(`${BASE}/api/labs/${labId}/findings/${f.id}`, { headers: hdr, data: { accreditor: "CMS", root_cause: "PW made-up root cause" } });

  await page.setViewportSize({ width: 1400, height: 1000 });

  // Staff, no delegation: history visible, no sign-off button.
  await injectAuth(page, BASE, staff.token);
  await page.goto(`${BASE}/labs/${labId}/veritaresponse/${f.id}`);
  const historyCard = page.getByTestId("finding-history");
  await expect(historyCard).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId("finding-history-row")).toHaveCount(2);
  await expect(page.getByTestId("finding-signoff-btn")).toHaveCount(0);
  await historyCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/finding-signoff-staff.png" });

  // Medical director on a view-only seat: button offered, signs, history shows it.
  await page.context().clearCookies();
  await page.evaluate(() => localStorage.clear());
  await injectAuth(page, BASE, md.token);
  await page.goto(`${BASE}/labs/${labId}/veritaresponse/${f.id}`);
  const btn = page.getByTestId("finding-signoff-btn");
  await expect(btn).toBeVisible({ timeout: 30000 });
  await expect(btn).toHaveText("Sign off and close as medical director");
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(page.getByTestId("finding-history-row").first()).toContainText("Signed off and closed as medical director", { timeout: 15000 });
  await expect(page.getByTestId("finding-history-row").first()).toContainText("PW Medical Director");
  await historyCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/finding-signoff-md-signed.png" });
});
