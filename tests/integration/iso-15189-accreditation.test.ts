// tests/integration/iso-15189-accreditation.test.ts
//
// STANDING integration test for parking lot #108 (2026-10-26): ISO 15189 as an add-on accreditation.
//   1. A database whose findings.accreditor CHECK predates ISO is rebuilt on boot: every row, column value, index and
//      the child reminder-log row survive, and the table then accepts 'ISO'.
//   2. Account Settings returns and saves accreditation_iso as an add-on (the CLIA choice is unchanged), audits the
//      change, and an older client that does not send it leaves it alone.
//   3. VeritaResponse refuses an ISO finding until the lab is flagged, then takes the lab-entered due date (no automatic
//      clock), keeps it on a save without one, and replaces it on a save with a new one.
//   4. The admin update-lab route sets the flag, and /api/labs/me reports it.
//   5. The same due-date code: an internal non-conforming event keeps no deadline when saved (was Other + 30).
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:iso-15189

import http from "node:http";
import express from "express";
import Database from "better-sqlite3";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// The findings table as it stood before 2026-10-26 (CHECK without 'ISO'), plus one child table and one index.
function seedOldSchema(path: string) {
  const old = new Database(path);
  old.pragma("foreign_keys = OFF");
  old.exec(`
    CREATE TABLE findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      accreditor TEXT NOT NULL CHECK(accreditor IN ('CAP','TJC','COLA','CMS','AABB','Other')),
      inspection_id TEXT, finding_number TEXT, standard_ref TEXT, phase_or_severity TEXT, description TEXT,
      surveyor_notes TEXT, anchor_date TEXT, due_date TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','drafting','submitted','accepted','rejected_resubmit','closed')),
      immediate_action TEXT, containment TEXT, root_cause TEXT, corrective_action TEXT, preventive_action TEXT,
      monitoring_plan TEXT, completion_date TEXT, signed_by TEXT, signed_at TEXT, external_submission_ref TEXT,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
      lab_id INTEGER REFERENCES labs(id)
    );
    CREATE INDEX idx_findings_lab ON findings(lab_id, due_date);
    CREATE TABLE finding_reminder_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, finding_id INTEGER NOT NULL, reminder_type TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')), recipient_email TEXT,
      UNIQUE(finding_id, reminder_type), FOREIGN KEY (finding_id) REFERENCES findings(id)
    );
  `);
  old.prepare("INSERT INTO findings (id, user_id, accreditor, finding_number, description, anchor_date, due_date, root_cause) VALUES (7, 1, 'CAP', 'GEN.20377', 'Old CAP finding', '2026-09-01', '2026-10-01', 'Old root cause')").run();
  old.prepare("INSERT INTO findings (id, user_id, accreditor, finding_number, description, status) VALUES (8, 1, 'Other', 'X-1', 'Old other finding', 'closed')").run();
  old.prepare("INSERT INTO finding_reminder_log (finding_id, reminder_type, recipient_email) VALUES (7, 'due_7', 'it@example.com')").run();
  old.close();
}

async function main() {
  const dbPath = process.env.DB_PATH || "";
  check("0a. DB_PATH points at a throwaway file", /\.tmp-iso-15189\.db$/.test(dbPath), dbPath);
  seedOldSchema(dbPath);

  // Import AFTER the old schema exists, so db.ts boots against it exactly as production does.
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;

  // 1. Rebuild
  const stored = (sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='findings'").get() as any).sql as string;
  check("1a. findings CHECK now allows 'ISO'", stored.includes("'AABB','ISO','Other'"), stored.slice(0, 160));
  const old7 = sqlite.prepare("SELECT * FROM findings WHERE id = 7").get() as any;
  const old8 = sqlite.prepare("SELECT * FROM findings WHERE id = 8").get() as any;
  check("1b. both old rows survive with their values", old7?.accreditor === "CAP" && old7?.finding_number === "GEN.20377" && old7?.root_cause === "Old root cause" && old7?.due_date === "2026-10-01" && old8?.status === "closed", JSON.stringify({ old7, old8 }).slice(0, 200));
  const cols = (sqlite.prepare("PRAGMA table_info(findings)").all() as any[]).map((c) => c.name);
  check("1c. columns added by the boot ALTERs are present after the rebuild", ["source_type", "qc_run_voided_note", "fda_report_due"].every((c) => cols.includes(c)), cols.slice(-6).join(","));
  const idx = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='findings'").all() as any[]).map((r) => r.name);
  check("1d. the findings index is recreated", idx.includes("idx_findings_lab"), idx.join(","));
  const child = sqlite.prepare("SELECT finding_id FROM finding_reminder_log WHERE reminder_type = 'due_7'").get() as any;
  const fkProblems = (sqlite.prepare("PRAGMA foreign_key_check").all() as any[]).filter((o) => o.parent === "findings");
  check("1e. the child reminder row still points at finding 7, no orphans", child?.finding_id === 7 && fkProblems.length === 0, JSON.stringify(fkProblems));
  check("1f. foreign keys are back on after the rebuild", sqlite.pragma("foreign_keys", { simple: true }) === 1);
  check("1g. the old rebuild table is gone", !sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'findings_iso_rebuild'").get());

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const PW = ["Is", "o1", "5189x!"].join("-");
  const email = `it-iso-${Date.now()}@example.com`;

  try {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT ISO Owner", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT ISO Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("2a. lab made", labId > 0 && !!token);

    // 3 (before the flag). An ISO finding is refused while the lab is not flagged.
    const refused = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "ISO", description: "Nonconformity 1", anchor_date: "2026-10-20", due_date: "2026-11-30", status: "open" }, token, labId);
    check("3a. ISO finding refused before the lab is flagged", refused.status === 400 && /not flagged as ISO/.test(String(refused.body?.error)), JSON.stringify(refused.body));

    // 2. Account Settings: CAP plus ISO.
    const put1 = await call("PUT", "/api/account/settings", { accreditation_choice: "CAP", accreditation_iso: true, clia_lab_name: "IT ISO Lab" }, token, labId);
    const get1 = await call("GET", "/api/account/settings", undefined, token, labId);
    check("2b. settings save CAP + ISO and read back both", put1.status === 200 && get1.body?.accreditation_choice === "CAP" && get1.body?.accreditation_iso === true, JSON.stringify({ put: put1.status, choice: get1.body?.accreditation_choice, iso: get1.body?.accreditation_iso }));
    const lab1 = sqlite.prepare("SELECT accreditation_cap, accreditation_iso FROM labs WHERE id = ?").get(labId) as any;
    check("2c. labs row has both flags", lab1.accreditation_cap === 1 && lab1.accreditation_iso === 1, JSON.stringify(lab1));
    const audit = sqlite.prepare("SELECT 1 FROM lab_audit_log WHERE lab_id = ? AND field_name = 'accreditation_iso'").get(labId);
    check("2d. the ISO change is in the lab audit log", !!audit);
    const put2 = await call("PUT", "/api/account/settings", { accreditation_choice: "TJC", clia_lab_name: "IT ISO Lab" }, token, labId);
    const lab2 = sqlite.prepare("SELECT accreditation_tjc, accreditation_cap, accreditation_iso FROM labs WHERE id = ?").get(labId) as any;
    check("2e. a save without accreditation_iso (older client) changes the choice and leaves ISO on", put2.status === 200 && lab2.accreditation_tjc === 1 && lab2.accreditation_cap === 0 && lab2.accreditation_iso === 1, JSON.stringify(lab2));

    // 4. /api/labs/me reports it.
    const me = await call("GET", "/api/labs/me", undefined, token);
    const m = (Array.isArray(me.body) ? me.body : me.body?.labs || me.body?.memberships || []).find((x: any) => Number(x.labId ?? x.lab_id) === labId);
    check("4a. /api/labs/me carries accreditationIso", m?.accreditationIso === true, JSON.stringify(m ?? me.body).slice(0, 200));

    // 3. Findings with ISO.
    const made = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "ISO", description: "Nonconformity 1", anchor_date: "2026-10-20", due_date: "2026-11-30", status: "open" }, token, labId);
    const fid = Number(made.body?.id ?? made.body?.finding?.id);
    const f1 = sqlite.prepare("SELECT accreditor, due_date FROM findings WHERE id = ?").get(fid) as any;
    check("3b. ISO finding saved with the lab-entered due date", made.status === 201 && f1?.accreditor === "ISO" && f1?.due_date === "2026-11-30", JSON.stringify({ status: made.status, f1, body: made.body }).slice(0, 220));
    const noDate = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "ISO", description: "Nonconformity 2", anchor_date: "2026-10-20", status: "open" }, token, labId);
    const f2 = sqlite.prepare("SELECT due_date FROM findings WHERE id = ?").get(Number(noDate.body?.id ?? noDate.body?.finding?.id)) as any;
    check("3c. ISO finding without a due date gets no automatic clock", noDate.status === 201 && f2?.due_date === null, JSON.stringify(f2));
    const full = sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(fid) as any;
    const { due_date: _omit, ...withoutDue } = full;
    const keep = await call("PUT", `/api/labs/${labId}/findings/${fid}`, { ...withoutDue, root_cause: "Training gap" }, token, labId);
    const f3 = sqlite.prepare("SELECT due_date, root_cause FROM findings WHERE id = ?").get(fid) as any;
    check("3d. a save without due_date keeps the ISO date", keep.status === 200 && f3.due_date === "2026-11-30" && f3.root_cause === "Training gap", JSON.stringify({ s: keep.status, f3 }));
    const change = await call("PUT", `/api/labs/${labId}/findings/${fid}`, { ...full, due_date: "2026-12-15" }, token, labId);
    const f4 = sqlite.prepare("SELECT due_date FROM findings WHERE id = ?").get(fid) as any;
    check("3e. a save with a new due_date replaces it", change.status === 200 && f4.due_date === "2026-12-15", JSON.stringify(f4));
    const cap = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "TJC", description: "TJC finding", anchor_date: "2026-10-01", due_date: "2026-10-02", status: "open" }, token, labId);
    const f5 = sqlite.prepare("SELECT due_date FROM findings WHERE id = ?").get(Number(cap.body?.id ?? cap.body?.finding?.id)) as any;
    check("3f. a non-ISO finding ignores a sent due_date and keeps its clock (TJC 60 days)", cap.status === 201 && f5?.due_date === "2026-11-30", JSON.stringify(f5));

    // 4. Admin update-lab turns it off.
    const upd = await call("POST", "/api/admin/update-lab", { secret: process.env.ADMIN_SECRET, labId, accIso: false });
    check("4b. admin update-lab sets the ISO flag", upd.status === 200 && upd.body?.lab?.accreditation_iso === 0, JSON.stringify(upd.body).slice(0, 200));
    const after = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "ISO", description: "Nonconformity 3", status: "open" }, token, labId);
    check("4c. with the flag off, new ISO findings are refused again", after.status === 400, String(after.status));

    // 5. Same due-date code path: an internal non-conforming event keeps no deadline when it is saved.
    const nce = await call("POST", `/api/labs/${labId}/findings`, { source_type: "internal_nce", description: "Specimen mislabeled at receiving", event_date: "2026-10-20", status: "open" }, token, labId);
    const nceId = Number(nce.body?.id);
    const nceRow = sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(nceId) as any;
    const nceSave = await call("PUT", `/api/labs/${labId}/findings/${nceId}`, { ...nceRow, root_cause: "Two labels printed for one order" }, token, labId);
    const nceAfter = sqlite.prepare("SELECT due_date, root_cause, accreditor FROM findings WHERE id = ?").get(nceId) as any;
    check("5a. an NCE is created with no due date", nce.status === 201 && nceRow?.due_date === null, JSON.stringify({ s: nce.status, d: nceRow?.due_date }));
    check("5b. saving the NCE keeps it without a due date (was Other + 30 days)", nceSave.status === 200 && nceAfter.due_date === null && nceAfter.root_cause === "Two labels printed for one order", JSON.stringify(nceAfter));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
