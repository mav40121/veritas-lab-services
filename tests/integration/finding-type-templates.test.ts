// tests/integration/finding-type-templates.test.ts
//
// STANDING integration test for the VeritaResponse entry-type templates (Michael 2026-10-26, mock D1-D7):
//   1. D2: a PT failure is stored under 'Other' (no accreditor gate) with its clock 30 days from the PT evaluation
//      received date; its type_details keep only the PT keys and shapes.
//   2. Type details: an internal event keeps phase and a valid count, drops a bad category; event_date and
//      discovered_by update on save; unknown keys never stored.
//   3. D1: a page save cannot close a finding or write the signature; the gated sign-off closes it; a new finding
//      cannot start closed; the legacy create route cannot make a closed or signed finding.
//   4. The entry type is fixed; an invalid PT root cause category is refused; escalation types cannot be made by hand.
//   5. D6: a VeritaQC escalation and a VeritaPT alternative-assessment escalation are saved as their own types under
//      'Other' with the 30-day lab target, not CMS 10 days.
//   6. The reminder email names the type ("Type: QC escalation") instead of "Accreditor: Other".
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:finding-type-templates

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { findingReminderCandidates, findingReminderEmail } from "../../server/audit";
import { labToday, addLabDays } from "../../server/dateLocal";

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
  const PW = ["Ft", "pl", "7x!"].join("-");
  const email = `it-ftypes-${Date.now()}@example.com`;
  let labId = 0;
  let token = "";
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const row = (id: number) => sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(id) as any;
  const details = (id: number) => JSON.parse(row(id)?.type_details || "{}");

  try {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT Types Owner", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Types Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made", labId > 0 && !!token);

    // 1. PT failure
    const pt = await call("POST", `/api/labs/${labId}/findings`, {
      source_type: "pt_failure", accreditor: "CAP", anchor_date: "2026-10-01", pt_program: "CAP", pt_event: "2026-B", pt_analyte: "Glucose", pt_score: "60% (3/5)",
      description: "Two of five challenges outside the range",
      type_details: { pt_checklist: { clerical: { answer: "yes", note: "Transcription checked" }, analytic: { answer: "maybe", note: "QC fine" }, bogus: { answer: "yes" } }, evidence_of_correction: "Repeat testing in range", unknown_key: "x" },
    });
    const ptRow = row(Number(pt.body?.id));
    const ptD = details(Number(pt.body?.id));
    check("1a. PT failure saved under Other although CAP was sent and the lab is not CAP-flagged", pt.status === 201 && ptRow?.accreditor === "Other", JSON.stringify({ s: pt.status, a: ptRow?.accreditor, e: pt.body?.error }));
    check("1b. its clock is 30 days from the evaluation received date", ptRow?.due_date === "2026-10-31", String(ptRow?.due_date));
    check("1c. type_details keep the PT keys only, in their shapes", ptD.pt_checklist?.clerical?.answer === "yes" && ptD.pt_checklist?.analytic?.answer === "" && ptD.pt_checklist?.analytic?.note === "QC fine" && !ptD.pt_checklist?.bogus && ptD.evidence_of_correction === "Repeat testing in range" && !("unknown_key" in ptD), JSON.stringify(ptD));

    // 2. Internal event details
    const nce = await call("POST", `/api/labs/${labId}/findings`, { source_type: "internal_nce", description: "Unlabeled tube", event_date: "2026-10-20", discovered_by: "Receiving", type_details: { nce_phase: "pre_analytic", nce_category: "not_a_category", patient_impact_count: "5", pt_checklist: { clerical: { answer: "yes" } } } });
    const nceId = Number(nce.body?.id);
    const nD = details(nceId);
    check("2a. NCE keeps phase and count, drops a bad category and another type's keys", nD.nce_phase === "pre_analytic" && nD.patient_impact_count === 5 && !("nce_category" in nD) && !("pt_checklist" in nD), JSON.stringify(nD));
    const nceFull = row(nceId);
    const nceSave = await call("PUT", `/api/labs/${labId}/findings/${nceId}`, { ...nceFull, type_details: { nce_phase: "analytic", nce_category: "specimen" }, event_date: "2026-10-19", discovered_by: "Night shift lead" });
    const nceAfter = row(nceId);
    check("2b. NCE save updates type_details, event_date and discovered_by", nceSave.status === 200 && details(nceId).nce_category === "specimen" && nceAfter.event_date === "2026-10-19" && nceAfter.discovered_by === "Night shift lead", JSON.stringify({ s: nceSave.status, d: details(nceId), e: nceAfter.event_date, b: nceAfter.discovered_by }));

    // 3. D1 closing and signature
    const insp = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "CMS", anchor_date: "2026-10-20", description: "Citation", signed_by: "Typed Name", signed_at: "2026-10-20T10:00:00" });
    const inspId = Number(insp.body?.id);
    check("3a. a new finding is never created signed", insp.status === 201 && row(inspId).signed_by === null && row(inspId).signed_at === null, JSON.stringify({ s: insp.status, sb: row(inspId)?.signed_by }));
    const closePut = await call("PUT", `/api/labs/${labId}/findings/${inspId}`, { ...row(inspId), status: "closed" });
    check("3b. a page save cannot close a finding", closePut.status === 409 && row(inspId).status === "open", JSON.stringify(closePut.body));
    const sigPut = await call("PUT", `/api/labs/${labId}/findings/${inspId}`, { ...row(inspId), signed_by: "Someone Else", signed_at: "2026-10-21T09:00:00", root_cause: "Training gap" });
    check("3c. a page save does not write the signature", sigPut.status === 200 && row(inspId).signed_by === null && row(inspId).root_cause === "Training gap", JSON.stringify({ s: sigPut.status, sb: row(inspId).signed_by }));
    const signed = await call("POST", `/api/labs/${labId}/findings/${inspId}/signoff`, {});
    const sRow = row(inspId);
    check("3d. the gated sign-off closes and signs it (owner as logged override here)", signed.status === 200 && sRow.status === "closed" && sRow.signoff_role === "owner_override" && !!sRow.signed_by, JSON.stringify({ s: signed.status, st: sRow.status, r: sRow.signoff_role }));
    const afterClose = await call("PUT", `/api/labs/${labId}/findings/${inspId}`, { ...sRow, monitoring_plan: "Audit at 30 days" });
    check("3e. a closed, signed finding can still be saved", afterClose.status === 200 && row(inspId).status === "closed", String(afterClose.status));
    const startClosed = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "CMS", anchor_date: "2026-10-20", status: "closed" });
    check("3f. a new finding cannot start closed", startClosed.status === 409, String(startClosed.status));
    const legacy = await call("POST", "/api/findings", { accreditor: "CMS", anchor_date: "2026-10-20", status: "closed", signed_by: "Typed", signed_at: "2026-10-20T10:00:00" });
    const lRow = row(Number(legacy.body?.id));
    check("3g. the legacy create route makes it open and unsigned", lRow?.status === "open" && lRow?.signed_by === null, JSON.stringify({ s: legacy.status, st: lRow?.status, sb: lRow?.signed_by }));

    // 4. Fixed type, PT category check, escalation types not by hand
    const retype = await call("PUT", `/api/labs/${labId}/findings/${nceId}`, { ...row(nceId), source_type: "inspection" });
    check("4a. the entry type cannot be changed", retype.status === 400 && row(nceId).source_type === "internal_nce", JSON.stringify(retype.body));
    const badCat = await call("PUT", `/api/labs/${labId}/findings/${Number(pt.body?.id)}`, { ...row(Number(pt.body?.id)), root_cause_category: "gremlins" });
    check("4b. an invalid PT root cause category is refused", badCat.status === 400, String(badCat.status));
    const goodCat = await call("PUT", `/api/labs/${labId}/findings/${Number(pt.body?.id)}`, { ...row(Number(pt.body?.id)), root_cause_category: "clerical", accreditor: "TJC" });
    check("4c. a valid category saves after creation, and a PT failure keeps Other", goodCat.status === 200 && row(Number(pt.body?.id)).root_cause_category === "clerical" && row(Number(pt.body?.id)).accreditor === "Other", JSON.stringify({ s: goodCat.status, a: row(Number(pt.body?.id)).accreditor }));
    const byHand = await call("POST", `/api/labs/${labId}/findings`, { source_type: "qc_escalation", accreditor: "CMS", anchor_date: "2026-10-20" });
    check("4d. a QC escalation cannot be created by hand", byHand.status === 400, String(byHand.status));

    // 5. Escalations
    const lot = Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd) VALUES (?, 'Glucose', 'Level 1', 'FT-1', 100, 3)").run(labId).lastInsertRowid);
    const run = Number(sqlite.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, instrument) VALUES (?, ?, 112, '2026-10-20', 'Analyzer A')").run(labId, lot).lastInsertRowid);
    const ca = await call("POST", `/api/labs/${labId}/qc/corrective-actions`, { qc_result_id: run, action_taken: "Reran control" });
    const esc = await call("POST", `/api/labs/${labId}/qc/corrective-actions/${ca.body?.corrective_action_id}/escalate-to-response`, {});
    const qRow = row(Number(esc.body?.finding_id));
    const target = addLabDays(labToday(), 30);
    check("5a. a QC escalation is its own type under Other with the 30-day target", qRow?.source_type === "qc_escalation" && qRow?.accreditor === "Other" && qRow?.due_date === target, JSON.stringify({ t: qRow?.source_type, a: qRow?.accreditor, d: qRow?.due_date, want: target, e: esc.body?.error }));
    const aa = Number(sqlite.prepare("INSERT INTO aa_records (user_id, lab_id, analyte, method, last_pass_fail, last_performed_date) VALUES (?, ?, 'Vitamin K', 'split_sample_external', 'fail', '2026-10-15')").run(userId, labId).lastInsertRowid);
    const aEsc = await call("POST", `/api/pt/aa-records/${aa}/escalate-to-response`, {});
    const aRow = row(Number(aEsc.body?.finding_id));
    check("5b. an alternative-assessment escalation is its own type under Other with the 30-day target", aRow?.source_type === "aaa_escalation" && aRow?.accreditor === "Other" && aRow?.due_date === target, JSON.stringify({ s: aEsc.status, t: aRow?.source_type, a: aRow?.accreditor, d: aRow?.due_date, e: aEsc.body?.error }));

    // 6. Reminder email
    const cand = findingReminderCandidates(sqlite).find((c: any) => c.id === qRow?.id);
    const mail = cand ? findingReminderEmail(cand, 7) : { subject: "", text: "" };
    check("6a. the QC reminder names the type, not 'Accreditor: Other'", mail.text.includes("Type: QC escalation") && !mail.text.includes("Accreditor: Other"), mail.text.slice(0, 300));
    check("6b. it says reminders stop at acceptance or sign-off", mail.text.includes("closed with the medical director or designee sign-off"));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
