// tests/integration/staff-setup-gates.test.ts
//
// Receipt for parking lot #84 Phase 2 (2026-10-08). Staff logins already reach
// the main lab API (an accepted staff seat gets a lab_members row, role
// 'staff'). Some setup routes checked only membership, so a staff login or any
// seatless member could build schedules, vendors, verification packages, CUSUM
// trackers, policy quizzes and shared documents, void QC runs, exclude runs from
// the baseline and file the monthly QC review. Boots the REAL routes on a
// scratch DB with four logins on one lab:
//   OWNER   the lab owner
//   WRITER  an active seat with edit_all (role 'staff' membership)
//   STAFF   a staff_portal seat, view_all (what an accepted Staff invite creates)
//   MEMBER  a 'staff' membership with no seat
// and proves, both ways:
//   1. every gated setup route answers 403 to STAFF and MEMBER and never 403 to
//      OWNER or WRITER
//   2. recording stays open: STAFF and MEMBER can enter a QC result, add a note
//      and file a corrective action
//   3. excluding a run from the baseline is 403 for STAFF, allowed for OWNER
//
// Run (Windows, from bash): DB_PATH=.tmp-ssg.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/staff-setup-gates.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const call = (method: string, path: string, body: unknown, token: string, labHeader?: number) =>
    fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(labHeader ? { "X-Active-Lab-Id": String(labHeader) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };

  const register = async (tag: string) => {
    const email = `ssg-${tag.toLowerCase()}-${stamp}@example.com`;
    const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "testpass123", name: `SSG ${tag}`, hipaa_acknowledged: true }) }));
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const OWNER = await register("Owner"), WRITER = await register("Writer"), STAFF = await register("Staff"), MEMBER = await register("Member");
  const labId = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: OWNER.email, labName: "SSG Lab", plan: "hospital" }) }))).labId);
  const member = (userId: number) => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at)
     SELECT ?, ?, 'staff', '{}', 'active', 0, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ?)`
  ).run(labId, userId, now, now, now, labId, userId);
  const seat = (u: { id: number; email: string }, type: string, perms: string) => sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(OWNER.id, u.email, u.id, now, now, perms, `ssg-${u.id}-${stamp}`, labId, type);
  member(WRITER.id); seat(WRITER, "active", '{"mode":"edit_all"}');
  member(STAFF.id); seat(STAFF, "staff_portal", '{"mode":"view_all"}');
  member(MEMBER.id);
  check("setup: owner + three members on one lab", labId > 0 && [OWNER, WRITER, STAFF, MEMBER].every((u) => u.id > 0 && !!u.token), JSON.stringify({ labId }));

  const L = `/api/labs/${labId}`;
  const lot = await j(await call("POST", `${L}/qc/control-lots`, { analyte: "PSA", level: "Level 1", lot_number: "L1", mfr_mean: 1.29, mfr_sd: 0.35 }, OWNER.token));
  const lotId = Number(lot?.lot?.id ?? lot?.id);
  const firstRun = await j(await call("POST", `${L}/qc/results`, { control_lot_id: lotId, result_value: 1.1, result_date: "2026-06-01" }, OWNER.token));
  const runId = Number(firstRun.result_id);

  // 1. setup routes: [label, method, path, body, labHeader?]
  const setup: [string, string, string, any, number?][] = [
    ["QC void a run", "POST", `${L}/qc/results/${runId}/void`, { reason: "test" }],
    ["QC monthly review", "POST", `${L}/qc/period-reviews`, { control_lot_id: lotId, period_year: 2026, period_month: 6 }],
    ["QC import mapping", "PUT", `${L}/qc/import-mappings/PSA`, { mapping: {} }],
    ["VeritaStock add vendor", "POST", `${L}/veritastock/vendors`, { name: "SSG Vendor" }],
    ["VeritaStock vendor import commit", "POST", `${L}/veritastock/vendors/import/commit`, { rows: [] }],
    ["VeritaCheck new verification", "POST", `${L}/veritacheck/verifications`, { instrument_name: "SSG", trigger_type: "new_instrument", elements: ["precision"] }],
    ["VeritaCheck new verification (legacy)", "POST", `/api/veritacheck/verifications`, { instrument_name: "SSG", trigger_type: "new_instrument", elements: ["precision"] }, labId],
    ["VeritaCheck CUSUM tracker", "POST", `${L}/veritacheck/cumsum/trackers`, { instrumentName: "SSG", analyte: "PSA" }],
    ["VeritaCheck CUSUM tracker (legacy)", "POST", `/api/veritacheck/cumsum/trackers`, { instrumentName: "SSG", analyte: "PSA" }, labId],
    ["VeritaShift add shift", "POST", `${L}/schedule/shifts`, { name: "Day", start_time: "07:00", end_time: "15:00", min_staff: 1 }],
    ["VeritaShift settings", "PUT", `${L}/schedule/settings`, {}],
    ["VeritaPolicy quiz config", "PUT", `${L}/veritapolicy/documents/999999/quiz-config`, {}],
  ];
  for (const [label, method, path, body, hdr] of setup) {
    const st: Record<string, number> = {};
    for (const [name, u] of [["OWNER", OWNER], ["WRITER", WRITER], ["STAFF", STAFF], ["MEMBER", MEMBER]] as const) {
      st[name] = (await call(method, path, body, u.token, hdr)).status;
    }
    check(`1. ${label}: STAFF and MEMBER 403, OWNER and WRITER not 403`,
      st.STAFF === 403 && st.MEMBER === 403 && st.OWNER !== 403 && st.WRITER !== 403, JSON.stringify(st));
  }

  // 1b. the shared repository is org-wide (every lab in the system sees it),
  // so it is owner/admin only: a writer seat is refused too, by design.
  {
    const st: Record<string, number> = {};
    for (const [name, u] of [["OWNER", OWNER], ["WRITER", WRITER], ["STAFF", STAFF], ["MEMBER", MEMBER]] as const) {
      st[name] = (await call("POST", `${L}/repository/documents`, { title: "SSG", url: "https://www.veritaslabservices.com" }, u.token)).status;
    }
    check("1b. Shared repository (org-wide): owner/admin only; WRITER, STAFF, MEMBER 403",
      st.OWNER !== 403 && st.WRITER === 403 && st.STAFF === 403 && st.MEMBER === 403, JSON.stringify(st));
  }

  // 2. recording stays open
  for (const [name, u] of [["STAFF", STAFF], ["MEMBER", MEMBER]] as const) {
    const r = await call("POST", `${L}/qc/results`, { control_lot_id: lotId, result_value: 1.12, result_date: "2026-06-02" }, u.token);
    const rid = Number((await j(r)).result_id);
    const n = await call("POST", `${L}/qc/results/${rid}/notes`, { note: "rerun, in range" }, u.token);
    const ca = await call("POST", `${L}/qc/corrective-actions`, { qc_result_id: rid, action_taken: "Reran control" }, u.token);
    check(`2. ${name} can still record: QC result, note, corrective action`, r.ok && n.ok && ca.ok, JSON.stringify({ result: r.status, note: n.status, ca: ca.status }));
  }

  // 3. exclude from baseline
  const r3 = Number((await j(await call("POST", `${L}/qc/results`, { control_lot_id: lotId, result_value: 1.6, result_date: "2026-06-03" }, STAFF.token))).result_id);
  const exStaff = await call("POST", `${L}/qc/corrective-actions`, { qc_result_id: r3, action_taken: "Reran", exclude_from_baseline: true }, STAFF.token);
  const stillAccepted = (sqlite.prepare("SELECT accepted_for_reporting FROM qc_results WHERE id = ?").get(r3) as any)?.accepted_for_reporting;
  const exOwner = await call("POST", `${L}/qc/corrective-actions`, { qc_result_id: r3, action_taken: "Reran", exclude_from_baseline: true }, OWNER.token);
  const nowExcluded = (sqlite.prepare("SELECT accepted_for_reporting FROM qc_results WHERE id = ?").get(r3) as any)?.accepted_for_reporting;
  check("3. exclude from baseline: STAFF 403 and the run stays in; OWNER allowed and the run is excluded",
    exStaff.status === 403 && stillAccepted === 1 && exOwner.ok && nowExcluded === 0,
    JSON.stringify({ staff: exStaff.status, after_staff: stillAccepted, owner: exOwner.status, after_owner: nowExcluded }));

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
