// tests/integration/veritaresponse-legacy-cleanup.test.ts
//
// STANDING integration test for POST /api/admin/veritaresponse/legacy-cleanup (parking lot #109, Michael 2026-10-26
// option 1). Made-up legacy rows, built the way the old code stored them:
//   f1  QC escalation (inspection / CMS), run voided, untouched      -> reclassified + closed with the void note
//   f2  QC escalation, run voided, root cause written                -> reclassified + flagged
//   f3  QC escalation, run not voided                                -> reclassified only
//   f4  manual inspection finding                                    -> untouched
//   f5  alternative-assessment escalation (aa_records link)          -> reclassified to aaa_escalation
//   f6  QC escalation, run voided, already closed                    -> reclassified, not reopened or re-closed
//   g1  the same as f1 on another lab                                -> only when no labId filter is given
// Checks: refused without the secret; the dry run writes nothing; labId narrows; apply keeps due dates and status
// (except the closes), writes history and audit; a second apply changes nothing more.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritaresponse-legacy-cleanup

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

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
  const post = async (p: string, body: unknown) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const secret = process.env.ADMIN_SECRET;

  try {
    const mkLab = async (tag: string) => {
      const email = `it-legacy-${tag}-${Date.now()}@example.com`;
      const reg = await post("/api/auth/register", { email, password: ["Lg", "cy", "7x!"].join("-"), name: `IT Legacy ${tag}`, hipaa_acknowledged: true });
      const labId = Number((await post("/api/admin/provision-demo-lab", { secret, ownerEmail: email, labName: `IT Legacy Lab ${tag}`, plan: "hospital" })).body?.labId);
      return { labId, userId: Number(reg.body?.user?.id) };
    };
    const A = await mkLab("a");
    const B = await mkLab("b");
    check("0. labs made", A.labId > 0 && B.labId > 0);
    sqlite.prepare("UPDATE users SET name = 'Mike Tester' WHERE id = ?").run(A.userId);

    const lot = (lab: number) => Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd) VALUES (?, 'Testosterone', 'Level 1', 'LG-1', 250, 50)").run(lab).lastInsertRowid);
    const run = (lab: number, l: number, voided: boolean, by: number) => Number(sqlite.prepare(
      "INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, instrument, voided_at, void_reason, voided_by_user_id) VALUES (?, ?, 286.6, '2026-09-29', 'FREND 2', ?, ?, ?)"
    ).run(lab, l, voided ? "2026-10-12T15:00:00Z" : null, voided ? "Entered incorrectly during training" : null, voided ? by : null).lastInsertRowid);
    // A legacy row: inspection / CMS, open, due 2026-10-15; extra columns (root_cause, standard_ref) set after.
    const finding = (lab: number, user: number, num: string, extra: Record<string, any> = {}) => {
      const id = Number(sqlite.prepare(
        "INSERT INTO findings (user_id, lab_id, accreditor, finding_number, standard_ref, description, surveyor_notes, anchor_date, due_date, status) VALUES (?, ?, 'CMS', ?, '42 CFR 493.1282', 'VeritaQC escalation.', 'Auto-created from VeritaQC corrective action.', '2026-10-05', '2026-10-15', 'open')"
      ).run(user, lab, num).lastInsertRowid);
      for (const [k, v] of Object.entries(extra)) sqlite.prepare(`UPDATE findings SET ${k} = ? WHERE id = ?`).run(v, id);
      return id;
    };
    const link = (lab: number, result: number, f: number) => sqlite.prepare("INSERT INTO qc_corrective_actions (lab_id, qc_result_id, action_taken, taken_by_user_id, nce_reference) VALUES (?, ?, 'Reran control', ?, ?)").run(lab, result, lab === A.labId ? A.userId : B.userId, `VeritaResponse#${f}`);

    const la = lot(A.labId);
    const f1 = finding(A.labId, A.userId, "QC-1-3s"); link(A.labId, run(A.labId, la, true, A.userId), f1);
    const f2 = finding(A.labId, A.userId, "QC-2-2s", { root_cause: "Vial warm" }); link(A.labId, run(A.labId, la, true, A.userId), f2);
    const f3 = finding(A.labId, A.userId, "QC-R-4s"); link(A.labId, run(A.labId, la, false, A.userId), f3);
    const f4 = finding(A.labId, A.userId, "D5413");
    const f5 = finding(A.labId, A.userId, "AAA-Vitamin K", { standard_ref: "42 CFR 493.1236(c)(1)" });
    sqlite.prepare("INSERT INTO aa_records (user_id, lab_id, analyte, method, last_pass_fail, response_finding_ref) VALUES (?, ?, 'Vitamin K', 'split_sample_external', 'fail', ?)").run(A.userId, A.labId, `VeritaResponse#${f5}`);
    const f6 = finding(A.labId, A.userId, "QC-1-3s"); sqlite.prepare("UPDATE findings SET status = 'closed' WHERE id = ?").run(f6); link(A.labId, run(A.labId, la, true, A.userId), f6);
    const lb = lot(B.labId);
    const g1 = finding(B.labId, B.userId, "QC-1-3s"); link(B.labId, run(B.labId, lb, true, B.userId), g1);
    const snapshot = () => JSON.stringify(sqlite.prepare("SELECT id, status, source_type, accreditor, due_date, qc_run_voided_note, surveyor_notes FROM findings WHERE id IN (?, ?, ?, ?, ?, ?, ?) ORDER BY id").all(f1, f2, f3, f4, f5, f6, g1));
    const before = snapshot();

    const noSecret = await post("/api/admin/veritaresponse/legacy-cleanup", { secret: "wrong" });
    check("1. refused without the admin secret", noSecret.status === 403);

    const dry = await post("/api/admin/veritaresponse/legacy-cleanup", { secret, labId: A.labId });
    const ids = (arr: any[]) => arr.map((x) => x.finding_id).sort((a, b) => a - b).join(",");
    check("2a. dry run is the default and writes nothing", dry.body?.dryRun === true && snapshot() === before);
    check("2b. reclassify list: the four QC escalations and the AAA one, not the manual finding", ids(dry.body.reclassify) === [f1, f2, f3, f5, f6].sort((a, b) => a - b).join(","), ids(dry.body.reclassify));
    check("2c. voided-run list: f1 close, f2 flag; the closed one and the live run are not listed",
      JSON.stringify(dry.body.voidedRun.map((v: any) => [v.finding_id, v.action])) === JSON.stringify([[f1, "close"], [f2, "flag"]]), JSON.stringify(dry.body.counts));
    check("2d. labId narrows to one lab (g1 on lab B is absent)", !dry.body.reclassify.some((r: any) => r.finding_id === g1) && !dry.body.voidedRun.some((v: any) => v.finding_id === g1));
    check("2e. the note names the void date, who voided it and why", dry.body.voidedRun[0]?.note === `The QC run behind this finding (result #${dry.body.voidedRun[0]?.qc_result_id}) was voided on 2026-10-12 by Mike Tester. Reason: Entered incorrectly during training`, dry.body.voidedRun[0]?.note);
    const all = await post("/api/admin/veritaresponse/legacy-cleanup", { secret });
    check("2f. without labId both labs are listed", all.body.voidedRun.some((v: any) => v.finding_id === g1));

    const applied = await post("/api/admin/veritaresponse/legacy-cleanup", { secret, labId: A.labId, dryRun: false });
    const row = (id: number) => sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(id) as any;
    check("3a. apply reports what it did", applied.body?.dryRun === false && applied.body.counts.voided_close === 1 && applied.body.counts.voided_flag === 1 && applied.body.counts.reclassify_qc === 4 && applied.body.counts.reclassify_aaa === 1, JSON.stringify(applied.body.counts));
    check("3b. f1 closed with the void note, a completion date, and its due date kept", row(f1).status === "closed" && !!row(f1).completion_date && String(row(f1).surveyor_notes).includes("Closed automatically: The QC run behind this finding") && row(f1).due_date === "2026-10-15");
    check("3c. f2 flagged, still open", row(f2).status === "open" && String(row(f2).qc_run_voided_note).includes("Entered incorrectly during training"));
    check("3d. QC escalations moved to qc_escalation / Other, due dates kept", [f1, f2, f3, f6].every((id) => row(id).source_type === "qc_escalation" && row(id).accreditor === "Other" && row(id).due_date === "2026-10-15"));
    check("3e. f3 still open, f6 still closed (status kept)", row(f3).status === "open" && row(f6).status === "closed");
    check("3f. the AAA escalation moved to aaa_escalation", row(f5).source_type === "aaa_escalation" && row(f5).accreditor === "Other");
    check("3g. the manual finding and the other lab are untouched", row(f4).source_type === "inspection" && row(f4).accreditor === "CMS" && row(g1).status === "open" && row(g1).source_type === "inspection");
    const hist = (id: number, ev: string) => !!sqlite.prepare("SELECT 1 FROM finding_history WHERE finding_id = ? AND event = ?").get(id, ev);
    check("3h. history rows written", hist(f1, "reclassified") && hist(f1, "closed_qc_run_voided") && hist(f2, "qc_run_voided") && hist(f5, "reclassified"));
    check("3i. audit rows written for the close and the flag", !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'finding.closed_qc_run_voided' AND entity_id = ?").get(String(f1)) && !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'finding.qc_run_voided' AND entity_id = ?").get(String(f2)));

    const again = await post("/api/admin/veritaresponse/legacy-cleanup", { secret, labId: A.labId, dryRun: false });
    check("3j. a second apply changes nothing more", again.body.counts.reclassify_qc === 0 && again.body.counts.reclassify_aaa === 0 && again.body.counts.voided_close === 0 && again.body.counts.voided_flag === 0 && again.body.counts.voided_already_flagged === 1, JSON.stringify(again.body.counts));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
