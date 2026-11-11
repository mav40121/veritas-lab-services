// tests/integration/unscoped-read-lab-isolation.test.ts
//
// A read of a lab-owned row by id, on a route with no lab in its path, must not cross labs. Found 2026-11-06: someone with no
// membership in a lab opened that lab's quiz through GET /api/veritacomp/quizzes/:id. Boots the REAL routes on a scratch DB with
// made-up people and rows and calls every such route as logins with no place in the lab: an owner of another lab on a paid plan
// (so plan gates don't hide anything), an editor seat in another lab, and a Staff login in another lab. Each route is also called
// by someone who belongs, so a missing fixture row can't pass as a refusal. Then every route of this shape registered on the app
// has to be listed here or excluded with a reason, so a new one fails until someone looks at it.
// Run: npm run test:unscoped-read-isolation
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const MARKER = /ZZ-LABA/;
const denied = (s: number) => s === 403 || s === 404;

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
  const call = async (method: string, path: string, body: unknown, token: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `iso-${tag.toLowerCase()}-${stamp}@example.com`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `Iso ${tag}`, hipaa_acknowledged: true }) })).json();
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id), token: reg.token as string };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);
  // A made-up row in any table: the columns the test cares about, plus a plain value for each other required column.
  const seed = (table: string, values: Record<string, any>): number => {
    const row: Record<string, any> = { ...values };
    for (const c of sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
      if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = /_at$/.test(c.name) ? now : /INT|REAL/.test(String(c.type)) ? 0 : "x";
    }
    const cols = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((k) => row[k])).lastInsertRowid);
  };
  const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, userId, role, now, now, now);
  const seat = (ownerId: number, lab: number, u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => seed("user_seats", {
    owner_user_id: ownerId, seat_email: u.email, seat_user_id: u.id, invited_at: now, accepted_at: now, status: "active", permissions: perms, invite_token: `iso-${u.id}-${lab}-${type}-${stamp}`, lab_id: lab, seat_type: type, staff_employee_id: rosterId,
  });

  try {
    // ── Lab A, and who belongs ────────────────────────────────────────────────
    const OWNER = await register("Owner"), EDITOR = await register("Editor"), STAFF = await register("Staff"), PLAIN = await register("Plain");
    const labA = await provision(OWNER.email, "Lab A");
    const LA = `/api/labs/${labA}`;
    await call("POST", `${LA}/staff/lab`, { labName: "Lab A", cliaNumber: "11D7654390", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const staffRow = Number((await call("POST", `${LA}/staff/employees`, { lastName: "ZZ-LABA-Tech", firstName: "Made", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    member(labA, EDITOR.id); seat(OWNER.id, labA, EDITOR, "active", '{"mode":"edit_all"}', null);
    member(labA, STAFF.id); seat(OWNER.id, labA, STAFF, "staff_portal", '{"mode":"view_all"}', staffRow);
    member(labA, PLAIN.id);

    // ── Rows in lab A, each carrying the marker where it has somewhere to put it ──
    const ownerAndLab = { user_id: OWNER.id, lab_id: labA };
    const study = seed("studies", { ...ownerAndLab, test_name: "ZZ-LABA study", instrument: "x", analyst: "x", date: "2026-10-15", study_type: "precision", clia_allowable_error: 0.1, data_points: "[]", instruments: "[]" });
    const mapId = seed("veritamap_maps", { ...ownerAndLab, name: "ZZ-LABA map" });
    const instrument = seed("veritamap_instruments", { map_id: mapId, instrument_name: "ZZ-LABA analyzer", role: "Primary", category: "Hematology" });
    seed("veritamap_instrument_tests", { map_id: mapId, instrument_id: instrument, analyte: "ZZ-LABA WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 });
    const test = seed("veritamap_tests", { map_id: mapId, analyte: "ZZ-LABA WBC", specialty: "Hematology", complexity: "MODERATE", updated_at: now });
    seed("veritamap_analyte_values", { map_id: mapId, analyte: "ZZ-LABA WBC", ref_range_low: "1", ref_range_high: "2", critical_low: "0.5", critical_high: "3" });
    seed("veritamap_amr_values", { map_id: mapId, instrument_id: instrument, analyte: "ZZ-LABA WBC", amr_low: "1", amr_high: "2" });
    const scan = seed("veritascan_scans", { ...ownerAndLab, name: "ZZ-LABA scan" });
    seed("veritascan_items", { scan_id: scan, item_id: 1, notes: "ZZ-LABA note", status: "Compliant" });
    const tracker = seed("cumsum_trackers", { ...ownerAndLab, instrument_name: "ZZ-LABA tracker" });
    const finding = seed("findings", { ...ownerAndLab, accreditor: "CMS", standard_ref: "ZZ-LABA 493.1", finding_number: "ZZ-LABA 1" });
    const program = seed("competency_programs", { ...ownerAndLab, name: "ZZ-LABA program" });
    const compEmp = seed("competency_employees", { ...ownerAndLab, name: "ZZ-LABA Tech", staff_employee_id: staffRow });
    const assessment = seed("competency_assessments", { program_id: program, employee_id: compEmp, assessment_date: "2026-10-15", evaluator_name: "ZZ-LABA Evaluator", status: "pass", assessment_type: "annual", competency_type: "technical" });
    seed("competency_assessment_items", { assessment_id: assessment, method_number: 1, element_number: 1, el1_specimen_id: "ZZ-LABA specimen" });
    const QUESTIONS = JSON.stringify([{ id: "q1", question: "ZZ-LABA which?", options: ["a", "b"], correct_answer: "a" }]);
    const quiz = seed("competency_quizzes", { ...ownerAndLab, program_id: program, title: "ZZ-LABA quiz", questions: QUESTIONS, created_at: now });
    const olderQuiz = seed("competency_quizzes", { user_id: OWNER.id, lab_id: null, program_id: program, title: "ZZ-LABA older quiz", questions: QUESTIONS, created_at: now });
    const systemQuiz = seed("competency_quizzes", { user_id: 0, lab_id: null, title: "System quiz", questions: JSON.stringify([{ id: "s1", question: "System question?", options: ["a", "b"], correct_answer: "a" }]), created_at: now });
    const assignment = seed("competency_quiz_assignments", { quiz_id: quiz, staff_employee_id: staffRow, lab_id: labA, assigned_by_user_id: OWNER.id, assigned_at: now, status: "assigned" });
    seed("competency_quiz_results", { quiz_id: quiz, employee_id: compEmp, assessment_id: assessment, date_taken: "2026-10-15", score: 90, passed: 0, answers: "[]" });
    const cert = seed("lab_certificates", { ...ownerAndLab, cert_name: "ZZ-LABA certificate", is_active: 1 });
    const certDoc = seed("lab_certificate_documents", { ...ownerAndLab, certificate_id: cert, filename: "f.pdf", original_filename: "ZZ-LABA.pdf", mime_type: "application/pdf", file_size: 7, file_data: Buffer.from("ZZ-LABA") });
    seed("cms116_drafts", { lab_id: labA, notes: "ZZ-LABA draft" });
    const enrollment = seed("pt_enrollments", { ...ownerAndLab, analyte: "ZZ-LABA WBC", specialty: "Hematology", pt_provider: "ZZ-LABA PT", enrollment_year: 2026, enrollment_date: "2026-01-01" });
    const ptEvent = seed("pt_events", { ...ownerAndLab, enrollment_id: enrollment, event_date: "2026-10-15", analyte: "ZZ-LABA WBC", event_name: "ZZ-LABA event" });
    seed("pt_corrective_actions", { ...ownerAndLab, event_id: ptEvent, corrective_action: "ZZ-LABA action", date_initiated: "2026-10-15" });
    const task = seed("veritatrack_tasks", { ...ownerAndLab, name: "ZZ-LABA task", category: "Maintenance", frequency: "Monthly", frequency_months: 1, active: 1, created_at: now, updated_at: now });
    seed("veritatrack_audit", { lab_id: labA, task_id: task, event: "created", detail: "ZZ-LABA audit", at: now, by_user_id: OWNER.id });
    const verification = seed("veritacheck_verifications", { ...ownerAndLab, instrument_name: "ZZ-LABA verification", trigger_type: "new_instrument" });
    seed("veritacheck_verification_analytes", { verification_id: verification, analyte_name: "ZZ-LABA WBC" });
    const staffing = seed("staffing_studies", { account_id: OWNER.id, lab_id: labA, name: "ZZ-LABA staffing" });
    const costStudy = seed("veritaops_test_cost_studies", { account_id: OWNER.id, lab_id: labA, test_name: "ZZ-LABA cost" });
    const department = seed("pi_departments", { account_id: OWNER.id, name: "ZZ-LABA department" });
    const metric = seed("pi_metrics", { department_id: department, account_id: OWNER.id, name: "ZZ-LABA metric" });
    const pendingSeat = seed("user_seats", { owner_user_id: OWNER.id, seat_email: `iso-pending-${stamp}@example.com`, invited_at: now, status: "pending", permissions: "{}", invite_token: `ZZ-LABA-token-${stamp}`, lab_id: labA, seat_type: "active" });
    const item = seed("inventory_items", { account_id: OWNER.id, lab_id: labA, item_name: "ZZ-LABA reagent" });
    seed("inventory_count_events", { lab_id: labA, account_id: OWNER.id, item_id: item, counted_qty: 5, previous_qty: 4, delta: 1, counted_by: "ZZ-LABA counter", source: "director", occurred_at: now, created_at: now });
    // A compliance digest issue (server/digestIssues.ts): its note carries the marker, and the owner sees a draft.
    const digestIssue = seed("digest_issues", { lab_id: labA, period_start: "2026-09-01", period_end: "2026-09-30", status: "draft", note: "ZZ-LABA digest note", sections: '["findings"]', audience: "staff" });
    check("0. fixture: lab A and its rows", !!labA && [study, mapId, scan, tracker, finding, program, assessment, quiz, olderQuiz, systemQuiz, assignment, cert, ptEvent, task, verification, staffing, costStudy, metric, digestIssue].every((x) => x > 0));

    // ── Logins with no place in lab A ─────────────────────────────────────────
    const OUT = await register("Outsider"), OUTSEAT = await register("Outseat"), OUTSTAFF = await register("Outstaff"), FREE = await register("Free");
    const labB = await provision(OUT.email, "Lab B");
    await call("POST", `/api/labs/${labB}/staff/lab`, { labName: "Lab B", cliaNumber: "11D7654391", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OUT.token);
    const outRow = Number((await call("POST", `/api/labs/${labB}/staff/employees`, { lastName: "Outside", firstName: "Olive", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OUT.token)).j.id);
    member(labB, OUTSEAT.id); seat(OUT.id, labB, OUTSEAT, "active", '{"mode":"edit_all"}', null);
    member(labB, OUTSTAFF.id); seat(OUT.id, labB, OUTSTAFF, "staff_portal", '{"mode":"view_all"}', outRow);
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id IN (?, ?, ?)").run(labB, OUT.id, OUTSEAT.id, OUTSTAFF.id);
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id IN (?, ?, ?, ?)").run(labA, OWNER.id, EDITOR.id, STAFF.id, PLAIN.id);
    // The sister lab: same owner as lab A, a different lab (Michael Q191 = 1). Their seats match the owner of every row here, and that no longer counts.
    const SISEDIT = await register("Sisedit"), SISSTAFF = await register("Sisstaff");
    const labC = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, created_at, updated_at) SELECT 'Lab C', owner_user_id, plan, subscription_status, subscription_expires_at, ?, ? FROM labs WHERE id = ?").run(now, now, labA).lastInsertRowid);
    member(labC, OWNER.id, "owner");
    await call("POST", `/api/labs/${labC}/staff/lab`, { labName: "Lab C", cliaNumber: "11D7654392", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const sisRow = Number((await call("POST", `/api/labs/${labC}/staff/employees`, { lastName: "Sister", firstName: "Sage", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    member(labC, SISEDIT.id); seat(OWNER.id, labC, SISEDIT, "active", '{"mode":"edit_all"}', null);
    member(labC, SISSTAFF.id); seat(OWNER.id, labC, SISSTAFF, "staff_portal", '{"mode":"view_all"}', sisRow);
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id IN (?, ?)").run(labC, SISEDIT.id, SISSTAFF.id);
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id = ?").run(labA, OWNER.id); // working in lab C just moved it
    const SISTERS = new Set<number>([SISEDIT.id, SISSTAFF.id]);
    const outsiders =[["owner of another lab", OUT], ["editor seat in another lab", OUTSEAT], ["Staff login in another lab", OUTSTAFF], ["no lab and no plan", FREE], ["editor seat in a sister lab", SISEDIT], ["Staff login in a sister lab", SISSTAFF]] as const;

    // ── Every route of the shape: [route as registered, url, method, body, what an outsider gets, statuses for someone who belongs] ──
    const OWN_LAB_ONLY = "own-lab";
    // noLabOnRow: the row has no lab on it, so the owner match still counts and a sister-lab seat reads it (Michael Q191 = 1).
    type Row = { route: string; url: string; method?: string; body?: unknown; outsider?: "denied" | typeof OWN_LAB_ONLY; belongs?: number[]; belongsToken?: string; noLabOnRow?: boolean };
    const q = quiz, a = assessment, f = finding;
    const routes: Row[] = [
      { route: "/api/studies/:id", url: `/api/studies/${study}` },
      { route: "/api/veritamap/maps/:id", url: `/api/veritamap/maps/${mapId}` },
      { route: "/api/veritamap/maps/:id/instruments", url: `/api/veritamap/maps/${mapId}/instruments` },
      { route: "/api/veritamap/maps/:id/intelligence", url: `/api/veritamap/maps/${mapId}/intelligence` },
      { route: "/api/veritamap/maps/:id/limits", url: `/api/veritamap/maps/${mapId}/limits` },
      { route: "/api/veritamap/maps/:id/analyte-values", url: `/api/veritamap/maps/${mapId}/analyte-values` },
      { route: "/api/veritamap/maps/:id/amr-values", url: `/api/veritamap/maps/${mapId}/amr-values` },
      { route: "/api/veritamap/correlations", url: `/api/veritamap/correlations?test_id=${test}` },
      { route: "/api/veritamap/correlations/candidate-partners", url: `/api/veritamap/correlations/candidate-partners?test_id=${test}` },
      { route: "/api/veritascan/scans/:id", url: `/api/veritascan/scans/${scan}` },
      { route: "/api/veritascan/scans/:id/items", url: `/api/veritascan/scans/${scan}/items` },
      { route: "/api/veritacheck/cumsum/trackers/:id", url: `/api/veritacheck/cumsum/trackers/${tracker}` },
      { route: "/api/veritacheck/cumsum/trackers/:id/excel", url: `/api/veritacheck/cumsum/trackers/${tracker}/excel` },
      ...["", "/poc-completeness", "/cap-completeness", "/tjc-completeness", "/cola-completeness", "/aabb-completeness", "/veritacheck-link"].map((s) => ({ route: `/api/findings/:id${s}`, url: `/api/findings/${f}${s}` })),
      ...["/cms-2567-pdf", "/internal-nce-pdf", "/type-report-pdf", "/cap-pdf", "/tjc-pdf", "/cola-pdf", "/aabb-pdf"].map((s) => ({ route: `/api/findings/:id${s}`, url: `/api/findings/${f}${s}`, belongs: [200, 400] })),
      { route: "/api/competency/programs/:id", url: `/api/competency/programs/${program}` },
      { route: "/api/veritacomp/assessments/:id", url: `/api/veritacomp/assessments/${a}` },
      { route: "/api/veritacomp/programs/:id/assessments", url: `/api/veritacomp/programs/${program}/assessments` },
      { route: "/api/veritacomp/programs/:id/quizzes", url: `/api/veritacomp/programs/${program}/quizzes` },
      { route: "/api/veritacomp/quizzes/:id", url: `/api/veritacomp/quizzes/${q}` },
      { route: "/api/veritacomp/quizzes/:id/assignments", url: `/api/veritacomp/quizzes/${q}/assignments` },
      { route: "/api/veritacomp/assessments/:id/quiz-results", url: `/api/veritacomp/assessments/${a}/quiz-results` },
      { route: "/api/veritacomp/assessments/:id/pdf", url: `/api/veritacomp/assessments/${a}/pdf` },
      { route: "/api/competency/map-instruments/:mapId", url: `/api/competency/map-instruments/${mapId}` },
      { route: "/api/staff/employees/:id", url: `/api/staff/employees/${staffRow}` },
      { route: "/api/account/seats/:seatId/invite-link", url: `/api/account/seats/${pendingSeat}/invite-link` },
      { route: "/api/account/seats/:seatId/activity", url: `/api/account/seats/${pendingSeat}/activity`, belongs: [200, 400] },
      { route: "/api/veritalab/certificates/:id/documents", url: `/api/veritalab/certificates/${cert}/documents` },
      { route: "/api/veritalab/certificates/:id/documents/:docId", url: `/api/veritalab/certificates/${cert}/documents/${certDoc}` },
      { route: "/api/labs/:labId/veritalab/cms116-draft", url: `${LA}/veritalab/cms116-draft` },
      { route: "/api/labs/:labId/veritalab/cms116-draft/pdf", url: `${LA}/veritalab/cms116-draft/pdf`, belongs: [200, 400, 500] },
      { route: "/api/labs/:labId/veritatrack/worklist", url: `${LA}/veritatrack/worklist`, outsider: OWN_LAB_ONLY },
      { route: "/api/veritapt/corrective-actions/event/:eventId", url: `/api/veritapt/corrective-actions/event/${ptEvent}`, outsider: OWN_LAB_ONLY },
      { route: "/api/veritapt/events", url: `/api/veritapt/events?enrollmentId=${enrollment}`, outsider: OWN_LAB_ONLY },
      { route: "/api/veritatrack/tasks/:id", url: `/api/veritatrack/tasks/${task}` },
      { route: "/api/veritatrack/tasks/:id/audit", url: `/api/veritatrack/tasks/${task}/audit` },
      { route: "/api/veritacheck/verifications/:id", url: `/api/veritacheck/verifications/${verification}` },
      { route: "/api/veritacheck/verifications/:id/analytes", url: `/api/veritacheck/verifications/${verification}/analytes` },
      { route: "/api/veritacheck/verifications/:id/map-analytes", url: `/api/veritacheck/verifications/${verification}/map-analytes` },
      { route: "/api/veritacheck/verifications/:id/suggest-studies", url: `/api/veritacheck/verifications/${verification}/suggest-studies` },
      { route: "/api/staffing-studies/:id", url: `/api/staffing-studies/${staffing}` },
      { route: "/api/staffing-studies/:id/export", url: `/api/staffing-studies/${staffing}/export` },
      { route: "/api/veritaops/studies/:id", url: `/api/veritaops/studies/${costStudy}` },
      { route: "/api/pi/metrics", url: `/api/pi/metrics?department_id=${department}`, outsider: OWN_LAB_ONLY, noLabOnRow: true },
      { route: "/api/inventory/count-history", url: `/api/inventory/count-history?item_id=${item}`, outsider: OWN_LAB_ONLY },
      // Reads that happen to be POST: a PDF or a workbook of one lab's row.
      { route: "POST /api/veritamap/maps/:id/excel", method: "POST", url: `/api/veritamap/maps/${mapId}/excel`, body: {}, belongs: [200, 400] },
      { route: "POST /api/veritascan/excel/:scanId", method: "POST", url: `/api/veritascan/excel/${scan}`, body: {}, belongs: [200, 400] },
      { route: "POST /api/veritascan/pdf/:scanId/:type", method: "POST", url: `/api/veritascan/pdf/${scan}/full`, body: {}, belongs: [200, 400] },
      { route: "POST /api/competency/pdf/:assessmentId", method: "POST", url: `/api/competency/pdf/${a}`, body: {}, belongs: [200, 400] },
      { route: "POST /api/veritacheck/cumsum/trackers/:id/pdf", method: "POST", url: `/api/veritacheck/cumsum/trackers/${tracker}/pdf`, body: {}, belongs: [200, 400] },
      { route: "POST /api/veritacheck/verifications/:id/pdf", method: "POST", url: `/api/veritacheck/verifications/${verification}/pdf`, body: {}, belongs: [200, 400] },
      { route: "POST /api/pi/metrics/:metricId/report", method: "POST", url: `/api/pi/metrics/${metric}/report`, body: {}, belongs: [200, 400], noLabOnRow: true },
      { route: "POST /api/veritaops/studies/:id/pdf", method: "POST", url: `/api/veritaops/studies/${costStudy}/pdf`, body: {}, belongs: [200, 400] },
    ];

    for (const r of routes) {
      const method = r.method || "GET";
      const own = await call(method, r.url, r.body, OWNER.token);
      const results: string[] = [];
      let leaked = false;
      for (const [who, u] of outsiders) {
        if (r.noLabOnRow && SISTERS.has(u.id)) continue;
        const got = await call(method, r.url, r.body, u.token);
        const shows = MARKER.test(got.text);
        // A PDF or workbook comes back as a token or a file, with no marker to look for, so a 200 there is a leak by status alone.
        const openOnStatus = r.outsider !== OWN_LAB_ONLY && got.s === 200;
        const bad = shows || openOnStatus;
        if (bad) leaked = true;
        results.push(`${who} ${got.s}${shows ? " WITH lab A data" : ""}`);
      }
      // Naming lab A in the active-lab header must not get anyone in.
      const named = await call(method, r.url, r.body, OUT.token, { "X-Active-Lab-Id": String(labA) });
      if (MARKER.test(named.text) || (r.outsider !== OWN_LAB_ONLY && named.s === 200)) { leaked = true; results.push(`header naming lab A ${named.s}`); }
      for (const [who, u] of [["sister editor", SISEDIT], ["sister Staff login", SISSTAFF]] as const) {
        if (r.noLabOnRow) continue;
        const sisterNamed = await call(method, r.url, r.body, u.token, { "X-Active-Lab-Id": String(labA) });
        if (MARKER.test(sisterNamed.text) || (r.outsider !== OWN_LAB_ONLY && sisterNamed.s === 200)) { leaked = true; results.push(`${who} header naming lab A ${sisterNamed.s}`); }
      }
      // And nothing here opens with no sign-in at all.
      const anon = await fetch(base + r.url, { method, headers: { "Content-Type": "application/json" }, body: r.body === undefined ? undefined : JSON.stringify(r.body) });
      if (anon.status === 200) { leaked = true; results.push(`no sign-in ${anon.status}`); }
      const belongsOk = (r.belongs || [200]).includes(own.s);
      console.log(`ROUTE  ${r.route}  owner ${own.s}  ${results.join("; ")}`);
      check(`1. ${r.route}: nobody outside lab A reads it`, !leaked, results.filter((x) => /200|WITH/.test(x)).join("; "));
      check(`2. ${r.route}: the lab's owner still reads it, so the row is really there`, belongsOk, `${own.s} ${own.j?.error ?? ""}`);
    }

    // ── The quiz itself ───────────────────────────────────────────────────────
    const quizUrl = `/api/veritacomp/quizzes/${quiz}`;
    const showsQuestion = (r: any) => r.s === 200 && Array.isArray(r.j.questions) && r.j.questions.length === 1 && r.j.questions[0].correct_answer === undefined;
    check("3a. the owner opens the lab's quiz to take, with no answers", showsQuestion(await call("GET", quizUrl, undefined, OWNER.token)));
    check("3b. an editor seat opens it too", showsQuestion(await call("GET", quizUrl, undefined, EDITOR.token)));
    check("3c. a Staff login in the lab opens it too", showsQuestion(await call("GET", quizUrl, undefined, STAFF.token)));
    check("3d. a member with no seat opens it too", showsQuestion(await call("GET", quizUrl, undefined, PLAIN.token)));
    const outQuiz = await call("GET", quizUrl, undefined, OUT.token);
    check("3e. someone outside the lab gets the same 404 as a quiz that doesn't exist, with no title or questions", outQuiz.s === 404 && outQuiz.j.error === "Quiz not found" && !MARKER.test(outQuiz.text), `${outQuiz.s} ${outQuiz.text.slice(0, 80)}`);
    const wrongLabHeader = await call("GET", quizUrl, undefined, OUT.token, { "X-Active-Lab-Id": String(labA) });
    check("3f. naming lab A in the header doesn't get them in", wrongLabHeader.s === 404, `${wrongLabHeader.s}`);
    check("3g. the answer key stays closed to outsiders", (await call("GET", `${quizUrl}?withAnswers=1`, undefined, OUT.token)).s === 404);
    check("3h. and to a Staff login in the lab", (await call("GET", `${quizUrl}?withAnswers=1`, undefined, STAFF.token)).j.code === "STAFF_NO_ANSWER_KEY");
    const ownerKey = await call("GET", `${quizUrl}?withAnswers=1`, undefined, OWNER.token);
    check("3i. the owner still gets the answer key", ownerKey.s === 200 && ownerKey.j.questions?.[0]?.correct_answer === "a");
    for (const [who, u] of outsiders.slice(0, 3)) check(`3j. a system-default quiz stays open: ${who}`, showsQuestion(await call("GET", `/api/veritacomp/quizzes/${systemQuiz}`, undefined, u.token)));
    check("3k. a system-default quiz stays open to the lab too", showsQuestion(await call("GET", `/api/veritacomp/quizzes/${systemQuiz}`, undefined, STAFF.token)));
    const olderUrl = `/api/veritacomp/quizzes/${olderQuiz}`;
    check("3l. an older quiz with no lab on it: the owner, an editor and a member of its program's lab open it", showsQuestion(await call("GET", olderUrl, undefined, OWNER.token)) && showsQuestion(await call("GET", olderUrl, undefined, EDITOR.token)) && showsQuestion(await call("GET", olderUrl, undefined, PLAIN.token)));
    check("3m. and nobody outside that lab does", (await call("GET", olderUrl, undefined, OUT.token)).s === 404);
    const labBProgram = seed("competency_programs", { user_id: OUT.id, lab_id: labB, name: "Lab B program" });
    const crossedQuiz = seed("competency_quizzes", { user_id: OWNER.id, lab_id: labA, program_id: labBProgram, title: "ZZ-LABA crossed quiz", questions: QUESTIONS, created_at: now });
    check("3m2. a quiz with its own lab goes by that lab, even if its program is somewhere else", (await call("GET", `/api/veritacomp/quizzes/${crossedQuiz}`, undefined, OUT.token)).s === 404 && showsQuestion(await call("GET", `/api/veritacomp/quizzes/${crossedQuiz}`, undefined, OWNER.token)));
    check("3n. a quiz id that doesn't exist is still 404", (await call("GET", "/api/veritacomp/quizzes/999999", undefined, OWNER.token)).s === 404);
    const listed = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${staffRow}`, undefined, STAFF.token);
    const opened = await call("GET", `/api/staff-portal-session/quizzes/${assignment}?employee_id=${staffRow}`, undefined, STAFF.token);
    const taken = await call("POST", `/api/staff-portal-session/quizzes/${assignment}/attempt`, { employee_id: staffRow, answers: [{ question_id: "q1", selected_answer: "a" }], typed_signature: "Made ZZ-LABA-Tech" }, STAFF.token);
    check("3o. a Staff login still lists, opens and takes their assigned quiz", listed.s === 200 && opened.s === 200 && taken.s === 200, `${listed.s}/${opened.s}/${taken.s} ${taken.j.error ?? ""}`);
    const otherStaffOpens = await call("GET", `/api/staff-portal-session/quizzes/${assignment}?employee_id=${outRow}`, undefined, OUTSTAFF.token);
    check("3p. a Staff login in another lab can't open that assignment", denied(otherStaffOpens.s), `${otherStaffOpens.s}`);

    // ── Reference values, which had no check at all ───────────────────────────
    const rangeRead = await call("GET", `/api/veritamap/maps/${mapId}/analyte-values`, undefined, EDITOR.token);
    const amrRead = await call("GET", `/api/veritamap/maps/${mapId}/amr-values`, undefined, PLAIN.token);
    check("4a. an editor still reads the map's reference ranges and critical values", rangeRead.s === 200 && rangeRead.j[0]?.critical_low === "0.5", `${rangeRead.s}`);
    check("4b. a member still reads its AMR values", amrRead.s === 200 && amrRead.j[0]?.amr_low === "1", `${amrRead.s}`);

    // ── A new route of this shape has to be looked at ─────────────────────────
    // Not lab-owned rows read by id: a secret token in the path, the admin secret, demo data, or the session's own record.
    const EXCLUDED: Array<[RegExp, string]> = [
      [/^\/api\/admin\//, "admin secret"],
      [/^\/api\/demo\//, "public demo data"],
      [/^\/api\/(pdf|zip)\/:token$/, "one-time download token"],
      [/^\/api\/export-all\/file\/:token$/, "one-time download token"],
      [/^\/api\/seats\/invite\/:token$/, "invite token"],
      [/^\/api\/surveyor\/:token\//, "surveyor link token"],
      [/^\/api\/public\/policy-share\/:token(\/file)?$/, "document share link token; the route reads no id (server/policyShareLinks.ts, tests/integration/veritadc-share-link.test.ts)"],
      [/^\/api\/scheduling\//, "public booking page"],
      [/^\/api\/labs\/:labId\/export-all$/, "owner only, checked per lab (ownerOnly)"],
      [/^\/api\/staff-portal-session\//, "session's own lab and roster row, in server/routes.ts staffPortalAuthMiddleware"],
    ];
    const listedRoutes = new Set(routes.map((r) => r.route));
    const unlisted: string[] = [];
    let shapeCount = 0;
    for (const layer of (app as any).router.stack) {
      const r = layer.route;
      if (!r?.methods?.get) continue;
      const names = r.stack.map((s: any) => s.name);
      if (names.includes("labScopeMiddleware")) continue;
      for (const p of Array.isArray(r.path) ? r.path : [r.path]) {
        if (typeof p !== "string" || !p.includes(":")) continue;
        if (EXCLUDED.some(([re]) => re.test(p))) continue;
        shapeCount++;
        if (!listedRoutes.has(p)) unlisted.push(p);
      }
    }
    check(`5. every GET taking an id with no lab scope (${shapeCount}) is checked here or excluded with a reason`, shapeCount > 40 && unlisted.length === 0, unlisted.join(" | "));

    // ── The next door over: a route scoped to the caller's OWN lab, handed lab A's row id ──
    const fillScoped = (path: string): string => path.replace(/:([A-Za-z_]+)/g, (_m, name, offset) => {
      const prev = path.slice(0, offset).split("/").filter(Boolean).pop() || "";
      if (name === "labId") return String(labB);
      if (name === "employeeId") return String(path.includes("/programs/") ? compEmp : staffRow);
      const byName: Record<string, number> = { mapId, scanId: scan, programId: program, assessmentId: assessment, quizId: quiz, instrumentId: instrument, studyId: study, findingId: finding, trackerId: tracker, verificationId: verification, taskId: task, enrollmentId: enrollment, eventId: ptEvent, certificateId: cert, itemId: item, docId: certDoc };
      if (name in byName) return String(byName[name]);
      const byPrev: Record<string, number> = { maps: mapId, scans: scan, programs: program, assessments: assessment, quizzes: quiz, instruments: instrument, studies: study, findings: finding, trackers: tracker, verifications: verification, tasks: task, enrollments: enrollment, events: ptEvent, certificates: cert, inventory: item, items: item, issues: digestIssue, employees: path.includes("/competency/") ? compEmp : staffRow };
      return String(byPrev[prev] ?? 1);
    });
    const scopedLeaks: string[] = [];
    let scopedCount = 0, scopedReached = 0;
    for (const layer of (app as any).router.stack) {
      const r = layer.route;
      if (!r?.methods?.get || !r.stack.some((s: any) => s.name === "labScopeMiddleware")) continue;
      for (const p of Array.isArray(r.path) ? r.path : [r.path]) {
        if (typeof p !== "string" || !p.replace(":labId", "").includes(":")) continue;
        scopedCount++;
        const got = await call("GET", fillScoped(p), undefined, OUT.token);
        if (MARKER.test(got.text)) scopedLeaks.push(`${got.s} ${p}`);
        // The control: does this url, in lab A, show the owner lab A's data? Only those prove anything about the outsider.
        const own = await call("GET", fillScoped(p).replace(`/api/labs/${labB}`, LA), undefined, OWNER.token);
        if (MARKER.test(own.text)) scopedReached++;
      }
    }
    console.log(`SCOPED  ${scopedCount} tried; the owner sees lab A's data on ${scopedReached} of them; leaks: ${scopedLeaks.join(" | ") || "none"}`);
    // ── Lists: a sister-lab seat, in its own lab, with and without naming lab A (Michael Q191 = 1) ──
    // pi/departments is by account with no lab on the row, so the owner match still counts there.
    const NO_LAB_ON_ROWS = new Set(["/api/pi/departments"]);
    const listUrls: string[] = [];
    for (const layer of (app as any).router.stack) {
      const r = layer.route;
      if (!r?.methods?.get) continue;
      for (const p of Array.isArray(r.path) ? r.path : [r.path]) {
        if (typeof p !== "string" || !p.startsWith("/api/") || NO_LAB_ON_ROWS.has(p) || /^\/api\/(admin|demo|pdf|zip|scheduling|surveyor|export-all|seats\/invite)/.test(p)) continue;
        if (p.replace(":labId", "").includes(":")) continue;
        listUrls.push(p.replace(":labId", String(labC)));
      }
    }
    const listLeaks: string[] = [];
    for (const url of listUrls) {
      for (const [who, u] of [["sister editor", SISEDIT], ["sister Staff login", SISSTAFF]] as const) {
        const plain = await call("GET", url, undefined, u.token);
        if (MARKER.test(plain.text)) listLeaks.push(`${who} ${plain.s} ${url}`);
        const named = await call("GET", url, undefined, u.token, { "X-Active-Lab-Id": String(labA) });
        if (MARKER.test(named.text)) listLeaks.push(`${who} naming lab A ${named.s} ${url}`);
      }
    }
    check(`7. no list (${listUrls.length} tried) shows a sister-lab seat lab A's rows, with or without naming lab A`, listUrls.length > 100 && listLeaks.length === 0, listLeaks.join(" | "));

    check(`6. a lab-scoped read (${scopedCount} tried, ${scopedReached} showing the owner data) never returns lab A's row to someone scoped to lab B`, scopedCount > 50 && scopedReached > 10 && scopedLeaks.length === 0, scopedLeaks.join(" | "));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
