// tests/integration/qc-void-finding.test.ts
//
// STANDING integration test for parking lot #100 (2026-10-26): voiding a QC run settles the VeritaResponse finding
// VeritaQC escalated from it. A finding nobody has worked closes, with the void reason in its notes, a completion
// date, a history row and an audit row; a finding with work on it is flagged (qc_run_voided_note) and keeps its
// status, and its reminder email says so; a closed finding is left alone; a run with no finding returns none.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:qc-void-finding

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { findingReminderCandidates, findingReminderEmail } from "../../server/audit";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const PW = ["Qv", "fd", "7x!"].join("-");
  const email = `it-qcvoid-${Date.now()}@example.com`;
  const post = async (p: string, body: unknown, token?: string) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };

  try {
    const reg = await post("/api/auth/register", { email, password: PW, name: "IT QC Owner", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await post("/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT QC Void Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await post("/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made", labId > 0 && !!token);

    const lot = Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd) VALUES (?, 'Glucose', 'Level 1', 'QV-1', 100, 3)").run(labId).lastInsertRowid);
    const run = (v: number) => Number(sqlite.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, instrument) VALUES (?, ?, ?, '2026-10-12', 'Analyzer A')").run(labId, lot, v).lastInsertRowid);
    const finding = (num: string, extra = "", status = "open") => Number(sqlite.prepare(
      `INSERT INTO findings (user_id, lab_id, accreditor, finding_number, standard_ref, due_date, status, root_cause, surveyor_notes)
       VALUES (?, ?, 'CMS', ?, '42 CFR 493.1282', '2026-11-02', ?, ?, 'Auto-created from VeritaQC corrective action.')`
    ).run(userId, labId, num, status, extra || null).lastInsertRowid);
    const link = (resultId: number, findingId: number) => sqlite.prepare(
      "INSERT INTO qc_corrective_actions (lab_id, qc_result_id, action_taken, taken_by_user_id, nce_reference) VALUES (?, ?, 'Reran control', ?, ?)"
    ).run(labId, resultId, userId, `VeritaResponse#${findingId}`);
    const r1 = run(130), r2 = run(131), r3 = run(99);
    const fUntouched = finding("QC-1-3s");
    const fClosed = finding("QC-1-3s-old", "", "closed");
    const fWorked = finding("QC-2-2s", "Reagent lot changed mid-run");
    link(r1, fUntouched); link(r1, fClosed); link(r2, fWorked);

    // 1) Untouched finding closes.
    const v1 = await post(`/api/labs/${labId}/qc/results/${r1}/void`, { reason: "Entered incorrectly during training" }, token);
    const f1 = sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(fUntouched) as any;
    check("1a. voiding returns the finding as closed (the already-closed one is not touched)", v1.status === 200 && JSON.stringify(v1.body?.findings) === JSON.stringify([{ id: fUntouched, action: "closed" }]), JSON.stringify(v1.body));
    check("1b. the finding is closed with a completion date and the void reason in its notes", f1.status === "closed" && !!f1.completion_date && String(f1.surveyor_notes).includes("Closed automatically") && String(f1.surveyor_notes).includes("Entered incorrectly during training") && String(f1.surveyor_notes).includes("Auto-created from VeritaQC"), JSON.stringify({ s: f1.status, c: f1.completion_date, n: f1.surveyor_notes }));
    check("1c. it is in the finding history and the audit trail",
      !!sqlite.prepare("SELECT 1 FROM finding_history WHERE finding_id = ? AND event = 'closed_qc_run_voided'").get(fUntouched) &&
      !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'finding.closed_qc_run_voided' AND entity_id = ?").get(String(fUntouched)));
    check("1d. a closed finding drops out of reminders", !findingReminderCandidates(sqlite).some((c: any) => c.id === fUntouched));
    check("1e. the already-closed finding is unchanged", (sqlite.prepare("SELECT surveyor_notes FROM findings WHERE id = ?").get(fClosed) as any).surveyor_notes === "Auto-created from VeritaQC corrective action.");

    // 2) Worked finding is flagged, not closed.
    const v2 = await post(`/api/labs/${labId}/qc/results/${r2}/void`, { reason: "Wrong lot scanned" }, token);
    const f2 = sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(fWorked) as any;
    check("2a. a finding with work on it is flagged, not closed", v2.status === 200 && v2.body?.findings?.[0]?.action === "flagged" && f2.status === "open" && String(f2.qc_run_voided_note).includes("Wrong lot scanned"), JSON.stringify({ body: v2.body, status: f2.status, note: f2.qc_run_voided_note }));
    const cand = findingReminderCandidates(sqlite).find((c: any) => c.id === fWorked);
    const mail = cand ? findingReminderEmail(cand, 7) : { text: "" };
    check("2b. its reminder email says the run was voided", mail.text.includes("Note: The QC run behind this finding") && mail.text.includes("If no action is needed, close the finding."), mail.text);
    check("2c. no em dashes in the reminder", !mail.text.includes("—"));

    // 3) A run with no finding.
    const v3 = await post(`/api/labs/${labId}/qc/results/${r3}/void`, { reason: "Duplicate entry" }, token);
    check("3. a run with no finding returns none", v3.status === 200 && Array.isArray(v3.body?.findings) && v3.body.findings.length === 0, JSON.stringify(v3.body));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
