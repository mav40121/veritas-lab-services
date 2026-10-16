// tests/integration/clear-backfill-values.test.ts
//
// BUG-068 cleanup (Q52 = 1): POST /api/admin/competency/clear-backfill-values clears the made-up competency values the
// old startup backfill wrote, and nothing else. Pins:
//   1. dry run (the default) reports what would change and changes nothing
//   2. unsigned items: every made-up field is cleared, on the shown element and in hidden fields
//   3. values the lab entered next to a made-up one are kept (real observer JQ; real quiz score 85)
//   4. a locked assessment and one with a method sign-off are untouched; a revoked sign-off does not protect
//   5. a lab in excludeLabIds (the demo lab) is untouched; items with only real values are untouched
//   6. one audit row per item changed, filed under the lab owner; running it again changes nothing; no secret = 403
// Run: npm run test:clear-backfill-values

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

const MADE_UP = {
  el1_specimen_id: "0326:C147", el1_observer_initials: "MV",
  el2_evidence: "0326:C147 - Sodium 141 mmol/L reported correctly, critical value callback documented per SOP", el2_date: "2026-01-16",
  el5_sample_type: "CAP PT Survey", el5_sample_id: "CAP-2026-C-01", el5_acceptable: 1,
  el6_quiz_id: "Q-AU5800-001", el6_score: 100, el6_date_taken: "2026-01-18",
};
const FIELDS = Object.keys(MADE_UP);

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const now = new Date().toISOString();
  const post = async (body: any, secret = process.env.ADMIN_SECRET) => {
    const r = await fetch(`${base}/api/admin/competency/clear-backfill-values`, { method: "POST", headers: { "Content-Type": "application/json", ...(secret ? { "x-admin-secret": secret } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    const owner = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Owner', 'hospital', ?)").run(`it-clear-${Date.now()}@example.com`, now).lastInsertRowid);
    const lab = (name: string) => Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id, plan, created_at, updated_at) VALUES (?, ?, ?, 'hospital', ?, ?)").run(name, `99D${Math.floor(Math.random() * 9e6 + 1e6)}`, owner, now, now).lastInsertRowid);
    const CLIENT = lab("IT Client Lab"), DEMO = lab("IT Demo Lab");
    const asmt = (labId: number, locked = 0) => {
      const prog = Number(sqlite.prepare("INSERT INTO competency_programs (user_id, name, type, lab_id, created_at, updated_at) VALUES (?, 'Chem', 'technical', ?, ?, ?)").run(owner, labId, now, now).lastInsertRowid);
      const emp = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, name, status, lab_id, created_at) VALUES (?, 'Pat Tech', 'active', ?, ?)").run(owner, labId, now).lastInsertRowid);
      return Number(sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, status, locked, created_at) VALUES (?, ?, 'initial', '2026-10-01', 'draft', ?, ?)").run(prog, emp, locked, now).lastInsertRowid);
    };
    const item = (assessmentId: number, el: number, vals: Record<string, any>) => {
      const cols = Object.keys(vals);
      return Number(sqlite.prepare(`INSERT INTO competency_assessment_items (assessment_id, method_number, element_number${cols.map((c) => ", " + c).join("")}) VALUES (?, ?, ?${cols.map(() => ", ?").join("")})`).run(assessmentId, el, el, ...cols.map((c) => vals[c])).lastInsertRowid);
    };
    const read = (id: number) => sqlite.prepare(`SELECT ${FIELDS.join(", ")} FROM competency_assessment_items WHERE id = ?`).get(id) as any;

    const open = asmt(CLIENT);
    const a = item(open, 6, { ...MADE_UP });                                                     // all made up (el6 shown, the rest hidden)
    const b = item(open, 1, { el1_specimen_id: "0326:C147", el1_observer_initials: "JQ" });       // real observer next to made-up specimen
    const c = item(open, 6, { el6_quiz_id: "Q-AU5800-001", el6_score: 85, el6_date_taken: "2026-10-02" }); // real score and date
    const real = item(open, 1, { el1_specimen_id: "ACC-55", el1_observer_initials: "MV" });       // a real MV observer, real specimen
    const locked = item(asmt(CLIENT, 1), 6, { ...MADE_UP });
    const signedA = asmt(CLIENT);
    const signed = item(signedA, 6, { ...MADE_UP });
    sqlite.prepare("INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, assessment_id, milestone, signed_date, signer_name, signer_role, created_at) VALUES (?, 1, 1, ?, 'initial', '2026-10-03', 'Dana Director', 'LD', ?)").run(CLIENT, signedA, now);
    const revokedA = asmt(CLIENT);
    const revoked = item(revokedA, 5, { el5_sample_type: "CAP PT Survey", el5_sample_id: "CAP-2026-C-01", el5_acceptable: 1 });
    sqlite.prepare("INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, assessment_id, milestone, signed_date, signer_name, signer_role, revoked_at, created_at) VALUES (?, 1, 1, ?, 'initial', '2026-10-03', 'Dana Director', 'LD', ?, ?)").run(CLIENT, revokedA, now, now);
    const demo = item(asmt(DEMO), 6, { ...MADE_UP });

    const no = await post({ dryRun: true }, "");
    check("6a. no admin secret: 403", no.status === 403, String(no.status));

    // 1) dry run
    const before = JSON.stringify([a, b, c, real, locked, signed, revoked, demo].map(read));
    const dry = await post({ excludeLabIds: [DEMO] });
    const ids = new Set<number>(dry.body.itemIds || []);
    check("1a. dry run by default lists the unsigned items with made-up values", dry.body.dryRun === true && ids.has(a) && ids.has(b) && ids.has(c) && ids.has(revoked) && ids.size === 4, JSON.stringify([...ids]));
    check("1b. dry run reports what it leaves (signed and excluded)", dry.body.leftSigned?.items === 2 && dry.body.leftExcluded?.items === 1, `signed ${dry.body.leftSigned?.items}, excluded ${dry.body.leftExcluded?.items}`);
    check("1c. dry run changes nothing", JSON.stringify([a, b, c, real, locked, signed, revoked, demo].map(read)) === before, "");

    // 2-5) apply
    const auditBefore = Number(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'competency_assessment_item'").get().n);
    const run = await post({ excludeLabIds: [DEMO], dryRun: false });
    const ra = read(a);
    check("2. an unsigned item: every made-up field is cleared, shown and hidden", FIELDS.every((f) => ra[f] === null), JSON.stringify(ra));
    const rb = read(b);
    check("3a. a real observer next to a made-up specimen ID is kept", rb.el1_specimen_id === null && rb.el1_observer_initials === "JQ", JSON.stringify({ s: rb.el1_specimen_id, o: rb.el1_observer_initials }));
    const rc = read(c);
    check("3b. a real quiz score and date next to a made-up quiz ID are kept", rc.el6_quiz_id === null && Number(rc.el6_score) === 85 && rc.el6_date_taken === "2026-10-02", JSON.stringify({ q: rc.el6_quiz_id, s: rc.el6_score, d: rc.el6_date_taken }));
    const rr = read(real);
    check("5b. an item with only real values is untouched (a real MV observer stays)", rr.el1_specimen_id === "ACC-55" && rr.el1_observer_initials === "MV", JSON.stringify(rr).slice(0, 80));
    check("4a. a locked assessment is untouched", read(locked).el6_quiz_id === "Q-AU5800-001", "");
    check("4b. an assessment with a method sign-off is untouched", read(signed).el6_quiz_id === "Q-AU5800-001", "");
    const rv = read(revoked);
    check("4c. a revoked sign-off does not protect made-up values", rv.el5_sample_id === null && rv.el5_sample_type === null && rv.el5_acceptable === null, JSON.stringify({ id: rv.el5_sample_id, t: rv.el5_sample_type, a: rv.el5_acceptable }));
    check("5a. the excluded (demo) lab is untouched", read(demo).el6_quiz_id === "Q-AU5800-001", "");
    const fields = 10 + 1 + 1 + 3;
    check("2b. the run reports the fields it cleared", run.body.fieldsCleared === fields, `${run.body.fieldsCleared} (expected ${fields})`);
    const auditAfter = Number(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'competency_assessment_item'").get().n);
    const ownerRows = Number(sqlite.prepare("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'competency_assessment_item' AND owner_user_id = ?").get(owner).n);
    check("6b. one audit row per item changed, under the lab owner", auditAfter - auditBefore === 4 && ownerRows === 4, `${auditAfter - auditBefore} rows, ${ownerRows} under owner`);
    const again = await post({ excludeLabIds: [DEMO], dryRun: false });
    check("6c. running it again changes nothing", again.body.toClear?.items === 0 && again.body.fieldsCleared === 0, JSON.stringify(again.body.toClear));
  } catch (e: any) {
    console.error(e);
    failures++;
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main();
