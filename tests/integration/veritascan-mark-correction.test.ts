// tests/integration/veritascan-mark-correction.test.ts
//
// Michael Q189 = 1 (2026-11-06): a one-time correction of automatic VeritaScan marks the records don't support. Boots the REAL routes on a scratch DB with made-up rows.
//   1. The secret comes from the header only.
//   2. A dry run is the default, writes nothing, and every value in it is a count, a flag or a lab id, so it can't carry a name.
//   3. It picks the right marks: VeritaComp outside today's mapping, VeritaCheck on a draft or failed study, and it reconciles with the audit route.
//   4. A row with the lab's own work stays: a typed note, an auto note with words added, an owner, a due date, a teaching note, evidence, a changed status.
//   5. A VeritaCheck mark stays when a passing study in the same scope marks that item, and only in that scope.
//   6. The scan screen's auto-save, which rewrites updated_at on every row, is not a change. It is counted, and the marks still move.
//   7. A write needs the count the dry run gave. It moves those rows, writes the note, audits each one, leaves the rest byte for byte, and a second run changes nothing.
//   8. A row changed after the plan stays, a failure part way changes nothing, and a later passing study can still reach a corrected
//      item, as evidence since BUG-135.
// BUG-135 (2026-11-09, Q246 = 1) adds the veritacheck_passing category: a22, a mark on a passing study, now moves too, keeping its study
// link. These labs have no VeritaMap, so no coverage is complete. tests/integration/veritacheck-scan-evidence.test.ts covers the category.
// Run: npm run test:veritascan-mark-correction
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ROUTE = "/api/admin/veritascan/correct-auto-marks";
const AUDIT = "/api/admin/veritascan/auto-completion-audit";
const MARK_DAY = "2026-01-05";
const MARK_AT = `${MARK_DAY}T12:00:00.000Z`;
const COMP_NOTE = `Auto-completed by VeritaComp™: technical assessment on ${MARK_DAY}`;
const OLD_COMP_NOTE = `Auto-completed by VeritaCompetency™: technical assessment on ${MARK_DAY}`;
const CHECK_NOTE = `Auto-completed by VeritaCheck®: Made-up Sodium on ${MARK_DAY}`;

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { planMarkCorrection, applyMarkCorrection, correctionNote, CORRECTED_SOURCE } = await import("../../server/veritascanMarkCorrection");
  const { autoCompleteVeritaScanItems, COMPETENCY_SCAN_ITEMS } = await import("../../server/integrations");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const now = new Date().toISOString();
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const admin = { "x-admin-secret": SECRET };
  const dry = async () => (await call("POST", ROUTE, { dryRun: true }, admin)).j;

  try {
    const email = `markfix-${Date.now()}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Owner Madeup", hipaa_acknowledged: true })).j;
    const T = reg.token as string;
    const ownerId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const otherId = Number((sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES ('markfix-other@example.test', 'x', 'Other Madeup', 'hospital', ?)").run(now).lastInsertRowid));
    const labA = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: SECRET, ownerEmail: email, labName: "Lab Named Xavier", plan: "hospital" })).j.labId);
    const mkLab = (name: string, isDemo: number) => Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, is_demo, created_at, updated_at) VALUES (?, ?, 'hospital', ?, ?, ?)").run(name, ownerId, isDemo, now, now).lastInsertRowid);
    const labB = mkLab("Lab Named Yolanda", 0), labDemo = mkLab("Lab Named Zelda", 1);
    const mkScan = (labId: number | null, name: string) => Number(sqlite.prepare("INSERT INTO veritascan_scans (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(ownerId, labId, name, MARK_AT, MARK_AT).lastInsertRowid);
    const A = mkScan(labA, "Xavier scan one"), A2 = mkScan(labA, "Xavier scan two"), B = mkScan(labB, "Yolanda scan"), DEMO = mkScan(labDemo, "Zelda scan"), NOLAB = mkScan(null, "Legacy scan");
    const seed = (scan: number, item: number, source: string, note: string | null, opts: { status?: string; link?: string | null; completionNote?: string | null; owner?: string; due?: string; teaching?: string } = {}) => Number(sqlite.prepare(
      "INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, due_date, teaching_note, completion_source, completion_link, completion_note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(scan, item, opts.status ?? "Compliant", note, opts.owner ?? null, opts.due ?? null, opts.teaching ?? null, source, opts.link ?? (source === "veritacomp_auto" ? "/veritacomp-app" : null), opts.completionNote === undefined ? (note ?? COMP_NOTE) : opts.completionNote, MARK_AT).lastInsertRowid);
    const mkStudy = (status: string, type: string, labId: number | null, userId = ownerId) => Number(sqlite.prepare(
      "INSERT INTO studies (test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, user_id, lab_id) VALUES ('Made-up Sodium', 'A', 'Made Up', ?, ?, 4, '[]', '[]', ?, ?, ?, ?)"
    ).run(MARK_DAY, type, status, now, userId, labId).lastInsertRowid);
    const link = (id: number) => `/study/${id}/results`;
    const evidence = (labId: number, item: number) => {
      const doc = Number(sqlite.prepare("INSERT INTO lab_documents (lab_id, title, document_type, external_url, linked_at, linked_by_user_id) VALUES (?, 'Made-up procedure', 'procedure', 'https://example.test/doc', ?, ?)").run(labId, now, ownerId).lastInsertRowid);
      sqlite.prepare("INSERT INTO document_checklist_links (document_id, checklist_item_id, linked_by_user_id, linked_at) VALUES (?, ?, ?, ?)").run(doc, item, ownerId, now);
    };

    // VeritaComp marks that move. Notes in every form they've had, or none: the auto-save creates rows, so a mark can land on a row with no note.
    const a61 = seed(A, 61, "veritacomp_auto", COMP_NOTE), a62 = seed(A, 62, "veritacomp_auto", COMP_NOTE), a63 = seed(A, 63, "veritacomp_auto", null);
    const a2_61 = seed(A2, 61, "veritacomp_auto", COMP_NOTE), b64 = seed(B, 64, "veritacomp_auto", OLD_COMP_NOTE), demo66 = seed(DEMO, 66, "veritacomp_auto", COMP_NOTE), nolab67 = seed(NOLAB, 67, "veritacomp_auto", COMP_NOTE);
    evidence(labA, 68);
    const b68 = seed(B, 68, "veritacomp_auto", COMP_NOTE); // the evidence for item 68 is in another lab
    // VeritaComp marks that stay.
    const a60 = seed(A, 60, "veritacomp_auto", COMP_NOTE); // still in the mapping
    const a65 = seed(A, 65, "veritacomp_auto", COMP_NOTE, { status: "Needs Attention" }); // the lab already changed it
    const a1 = seed(A, 1, "manual", "Reviewed by the lab", { completionNote: null }); // the lab's own answer
    const a2_65 = seed(A2, 65, "manual", COMP_NOTE); // the note says automatic, completion_source doesn't
    const b58 = seed(B, 58, "veritacomp_auto", "Our director reviewed this", { completionNote: COMP_NOTE });
    const b59 = seed(B, 59, "veritacomp_auto", `${COMP_NOTE}. Checked by the supervisor`, { completionNote: COMP_NOTE });
    const b62 = seed(B, 62, "veritacomp_auto", COMP_NOTE, { owner: "Made-up Owner" }), b63 = seed(B, 63, "veritacomp_auto", COMP_NOTE, { due: "2027-01-01" }), b66 = seed(B, 66, "veritacomp_auto", COMP_NOTE, { teaching: "Made-up teaching note" });
    evidence(labB, 143);
    const b143 = seed(B, 143, "veritacomp_auto", COMP_NOTE);
    // VeritaCheck. Lab A has a passing cal_ver, which marks 21 to 24 in lab A only. A no-lab pass marks its owner's scans. Someone else's pass marks nothing here.
    const passA = mkStudy("pass", "cal_ver", labA), failA = mkStudy("fail", "cal_ver", labA), failPrecA = mkStudy("fail", "precision", labA), draftB = mkStudy("draft", "cal_ver", labB);
    mkStudy("pass", "cal_ver", null, otherId);
    mkStudy("pass", "lot_to_lot", null);
    const draftNoLab = mkStudy("draft", "lot_to_lot", null);
    const c = (scan: number, item: number, study: number | null, note: string | null = CHECK_NOTE) => seed(scan, item, "veritacheck_auto", note, { link: study == null ? "/study/999999/results" : link(study), completionNote: CHECK_NOTE });
    const a30 = c(A, 30, failPrecA), b21 = c(B, 21, draftB);                    // these move
    const a21 = c(A, 21, failA), nolab99 = c(NOLAB, 99, draftNoLab);            // a passing study marks the same item, in scope
    const b27 = c(B, 27, draftB, "The lab's own words");                        // the lab's note
    const a22 = c(A, 22, passA), a23 = c(A, 23, null);                          // a passing study, and a study that's gone
    // Two more that move until the lab acts on them, through the real route.
    const a70 = seed(A, 70, "veritacomp_auto", COMP_NOTE), a71 = seed(A, 71, "veritacomp_auto", COMP_NOTE);

    const moving = [a61, a62, a63, a2_61, b64, demo66, nolab67, b68, a30, b21, a22];
    const staying = [a60, a65, a1, a2_65, b58, b59, b62, b63, b66, b143, a21, nolab99, b27, a23];
    const row = (id: number) => sqlite.prepare("SELECT * FROM veritascan_items WHERE id = ?").get(id) as any;
    const allRows = () => JSON.stringify(sqlite.prepare("SELECT * FROM veritascan_items ORDER BY id").all());
    const scansRaw = () => JSON.stringify(sqlite.prepare("SELECT id, updated_at FROM veritascan_scans ORDER BY id").all());
    const audits = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'veritascan_item'").get() as any).n);

    // 1. The secret
    check("1. no secret is refused", (await call("POST", ROUTE, {})).s === 403);
    check("1. a wrong secret is refused", (await call("POST", ROUTE, {}, { "x-admin-secret": "wrong" })).s === 403);
    check("1. a secret in the body is refused", (await call("POST", ROUTE, { secret: SECRET, dryRun: false, expectedTotal: 13 })).s === 403);
    check("1. a secret in the URL is refused", (await call("POST", `${ROUTE}?secret=${SECRET}`, { dryRun: false, expectedTotal: 13 })).s === 403);
    check("1. a signed-in owner is refused", (await call("POST", ROUTE, {}, { Authorization: `Bearer ${T}` })).s === 403);

    // 2. The dry run
    const beforeRows = allRows(), beforeScans = scansRaw();
    const changesBefore = Number((sqlite.prepare("SELECT total_changes() AS n").get() as any).n);
    const first = await call("POST", ROUTE, { dryRun: true }, admin);
    const noOptions = await call("POST", ROUTE, {}, admin);
    const emptyBody = await call("POST", ROUTE, undefined, admin);
    check("2. a dry run answers", first.s === 200 && first.j.ok === true && first.j.dryRun === true, first.text.slice(0, 160));
    check("2. no options means a dry run, with a body or without", noOptions.s === 200 && noOptions.j.dryRun === true && emptyBody.s === 200 && emptyBody.j.dryRun === true);
    check("2. a dry run writes nothing", Number((sqlite.prepare("SELECT total_changes() AS n").get() as any).n) === changesBefore && allRows() === beforeRows && scansRaw() === beforeScans && audits() === 0);
    const leaves: unknown[] = [];
    const walk = (v: unknown) => { if (v && typeof v === "object") Object.values(v as object).forEach(walk); else leaves.push(v); };
    walk(first.j);
    check("2. every value is a count or a flag, so it can't carry a name", leaves.length > 0 && leaves.every((v) => typeof v === "number" || typeof v === "boolean"), JSON.stringify(leaves.filter((v) => typeof v !== "number" && typeof v !== "boolean")));
    check("2. no lab, scan, person, email or note text", !/Xavier|Yolanda|Zelda|Legacy|Madeup|Made-up|example\.test|Auto-completed|director/.test(first.text));

    // 3. The right marks
    const d = first.j;
    check("3. VeritaComp: the marks to move, with the two the lab hasn't touched yet", d.veritacomp?.to_move === 10, JSON.stringify(d.veritacomp));
    check("3. VeritaCheck: the marks to move", d.veritacheck?.to_move === 2, JSON.stringify(d.veritacheck));
    check("3. VeritaCheck from a passing study (BUG-135): the mark on item 22 moves", d.veritacheck_passing?.to_move === 1 && d.veritacheck_passing?.from_passing_study_still_compliant === 1 && planMarkCorrection(sqlite).toMove.some((m: any) => m.id === a22 && m.module === "veritacheck_passing"), JSON.stringify(d.veritacheck_passing));
    check("3. the total", d.total_to_move === 13, String(d.total_to_move));
    check("3. item 60 is still in the mapping and isn't touched", JSON.stringify(COMPETENCY_SCAN_ITEMS.technical) === "[60]" && d.veritacomp?.in_current_mapping_not_touched === 1);
    check("3. a study that passed or is gone isn't touched", d.veritacheck?.study_not_draft_or_failed_not_touched === 1 && d.veritacheck?.study_not_found_not_touched === 1);
    const audit = (await call("GET", AUDIT, undefined, admin)).j;
    const lc = d.veritacomp?.left_alone ?? {}, lk = d.veritacheck?.left_alone ?? {};
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    check("3. VeritaComp reconciles with the audit route: to move plus left alone is its outside-the-mapping count", audit.veritacomp?.outside_current_mapping?.still_compliant === d.veritacomp?.outside_mapping_still_compliant && d.veritacomp?.to_move + sum(lc) === d.veritacomp?.outside_mapping_still_compliant, `${audit.veritacomp?.outside_current_mapping?.still_compliant} vs ${d.veritacomp?.outside_mapping_still_compliant}`);
    check("3. VeritaCheck reconciles with the audit route's draft or failed count", audit.veritacheck?.from_draft_or_failed_study === d.veritacheck?.from_draft_or_failed_study_still_compliant && d.veritacheck?.to_move + sum(lk) === d.veritacheck?.from_draft_or_failed_study_still_compliant, `${audit.veritacheck?.from_draft_or_failed_study} vs ${d.veritacheck?.from_draft_or_failed_study_still_compliant}`);
    const lab = (j: any, id: number) => (j.by_lab ?? []).find((x: any) => x.lab_id === id) ?? {};
    check("3. per lab: lab A", lab(d, labA).veritacomp === 6 && lab(d, labA).veritacheck === 1 && lab(d, labA).veritacheck_passing === 1 && lab(d, labA).scans_with_a_mark_to_move === 2 && lab(d, labA).left_alone === 2 && lab(d, labA).is_demo === false, JSON.stringify(lab(d, labA)));
    check("3. per lab: lab B", lab(d, labB).veritacomp === 2 && lab(d, labB).veritacheck === 1 && lab(d, labB).scans_with_a_mark_to_move === 1 && lab(d, labB).left_alone === 7, JSON.stringify(lab(d, labB)));
    check("3. per lab: a demo lab says so", lab(d, labDemo).veritacomp === 1 && lab(d, labDemo).is_demo === true, JSON.stringify(lab(d, labDemo)));
    check("3. scans with no lab are counted apart", d.scans_with_no_lab?.veritacomp === 1 && d.scans_with_no_lab?.left_alone === 1 && d.scans_with_no_lab?.scans_with_a_mark_to_move === 1, JSON.stringify(d.scans_with_no_lab));

    // 4. and 5. Why the others stay
    check("4. a typed note and an auto note with words added both stay", lc.lab_note_on_item === 2, JSON.stringify(lc));
    check("4. an owner, a due date or a teaching note stays", lc.owner_due_or_teaching_note_set === 3, JSON.stringify(lc));
    check("4. evidence linked in this lab stays, and evidence in another lab doesn't count", lc.evidence_linked === 1, JSON.stringify(lc));
    check("4. a note that says automatic with a source that doesn't stays", lc.source_not_automatic === 1, JSON.stringify(lc));
    check("4. a status the lab already changed is not a mark to move", !planMarkCorrection(sqlite).toMove.some((m: any) => m.id === a65));
    check("4. a VeritaCheck row with the lab's note stays", lk.lab_note_on_item === 1, JSON.stringify(lk));
    check("5. a passing study in the same lab, or the owner's with no lab, keeps the mark", lk.another_passing_study_supports === 2, JSON.stringify(lk));
    const plannedIds = new Set(planMarkCorrection(sqlite).toMove.map((m: any) => m.id));
    check("5. a pass in another lab, or by someone else, doesn't keep it", plannedIds.has(b21));
    check("5. a pass of another study type doesn't keep it", plannedIds.has(a30));

    // 6. The auto-save
    check("6. before any save, no mark reads as saved since", d.scan_saved_after_mark === 0, String(d.scan_saved_after_mark));
    const L = `/api/labs/${labA}/veritascan/scans/${A}`;
    const auth = { Authorization: `Bearer ${T}`, "X-Active-Lab-Id": String(labA) };
    const onScreen = (await call("GET", `${L}/items`, undefined, auth)).j as any[];
    const saved = await call("PUT", `${L}/items`, { items: onScreen }, auth);
    check("6. the screen's auto-save sends the whole scan back", saved.s === 200 && saved.j.count === onScreen.length && onScreen.length > 5, saved.text.slice(0, 120));
    check("6. setup: that rewrote updated_at on a mark nobody touched", row(a61).updated_at !== MARK_AT && row(a61).status === "Compliant" && row(a61).completion_source === "veritacomp_auto", row(a61).updated_at);
    const afterSave = await dry();
    check("6. the marks still move: a rewritten timestamp isn't a change", afterSave.total_to_move === 13, String(afterSave.total_to_move));
    check("6. and they're counted as sitting in a scan saved since the mark", afterSave.scan_saved_after_mark === 7, String(afterSave.scan_saved_after_mark));

    // 4, through the real route: the lab acts on two of them.
    check("4. setup: the lab adds a note to one", (await call("PUT", `${L}/items/70`, { status: "Compliant", notes: "We checked this one" }, auth)).s === 200);
    check("4. setup: and changes the status of another", (await call("PUT", `${L}/items/71`, { status: "Needs Attention", notes: COMP_NOTE }, auth)).s === 200);
    const afterEdits = await dry();
    check("4. both stop being marks to move", afterEdits.total_to_move === 11 && afterEdits.veritacomp.left_alone.lab_note_on_item === 3, JSON.stringify(afterEdits.veritacomp));
    staying.push(a70, a71);

    // 7. The write
    const beforeWrite = allRows();
    const noCount = await call("POST", ROUTE, { dryRun: false }, admin);
    check("7. a write with no count is refused", noCount.s === 409 && noCount.j.code === "COUNT_CHANGED" && noCount.j.total_to_move === 11, noCount.text.slice(0, 160));
    const staleCount = await call("POST", ROUTE, { dryRun: false, expectedTotal: 13 }, admin);
    check("7. a write naming an old count is refused", staleCount.s === 409 && staleCount.j.code === "COUNT_CHANGED", staleCount.text.slice(0, 160));
    const asText = await call("POST", ROUTE, { dryRun: false, expectedTotal: "11" }, admin);
    check("7. a count sent as text is refused", asText.s === 409);
    check("7. a refused write changes nothing", allRows() === beforeWrite && audits() === 0);
    const left = Object.fromEntries(staying.map((id) => [id, JSON.stringify(row(id))]));
    const auditBeforeWrite = (await call("GET", AUDIT, undefined, admin)).j;
    const wrote = await call("POST", ROUTE, { dryRun: false, expectedTotal: 11 }, admin);
    check("7. the write answers", wrote.s === 200 && wrote.j.dryRun === false && wrote.j.changed === 11 && wrote.j.remaining === 0, wrote.text.slice(0, 200));
    const today = new Date().toISOString().slice(0, 10);
    const compMoved = moving.filter((id) => id !== a30 && id !== b21 && id !== a22);
    check("7. each moved row reads Not Assessed", moving.every((id) => row(id).status === "Not Assessed"), JSON.stringify(moving.map((id) => row(id).status)));
    check("7. a VeritaComp row carries the note saying why", compMoved.every((id) => row(id).notes === correctionNote("veritacomp", today) && row(id).completion_note === row(id).notes), row(a61).notes);
    check("7. a VeritaCheck row carries its own", [a30, b21].every((id) => row(id).notes === correctionNote("veritacheck", today)), row(a30).notes);
    check("7. the notes have no em dash and the right marks", !/—/.test(correctionNote("veritacomp", today) + correctionNote("veritacheck", today)) && correctionNote("veritacomp", today).includes("VeritaComp™") && correctionNote("veritacheck", today).includes("VeritaCheck®"));
    check("7. the source says it was corrected, and the link is gone", moving.filter((id) => id !== a22).every((id) => row(id).completion_source === CORRECTED_SOURCE && row(id).completion_link === null));
    check("7. a mark from a passing study reads corrected and keeps its study link as evidence", row(a22).completion_source === CORRECTED_SOURCE && row(a22).completion_link === link(passA) && row(a22).notes === correctionNote("veritacheck_passing", today), JSON.stringify(row(a22)));
    check("7. every other row is byte for byte the same", staying.every((id) => JSON.stringify(row(id)) === left[id]), staying.filter((id) => JSON.stringify(row(id)) !== left[id]).join(","));
    const scanTime = (id: number) => (sqlite.prepare("SELECT updated_at AS u FROM veritascan_scans WHERE id = ?").get(id) as any).u;
    check("7. the scans it changed show it", [A2, B, DEMO, NOLAB].every((id) => scanTime(id) !== MARK_AT));
    check("7. each moved row has an audit row", audits() === 11, String(audits()));
    const auditRow = sqlite.prepare("SELECT owner_user_id, before_json, after_json, entity_label FROM audit_log WHERE entity_type = 'veritascan_item' AND entity_id = ?").get(String(a61)) as any;
    const before = JSON.parse(auditRow?.before_json ?? "{}");
    check("7. the audit row holds what the row said before, so it can be read back", before.status === "Compliant" && before.notes === COMP_NOTE && before.completion_source === "veritacomp_auto" && before.completion_link === "/veritacomp-app", auditRow?.before_json);
    check("7. it's filed under the lab's owner", Number(auditRow?.owner_user_id) === ownerId, String(auditRow?.owner_user_id));
    const auditAfter = (await call("GET", AUDIT, undefined, admin)).j;
    check("7. the audit route's counts fall by exactly what moved", auditAfter.veritacomp?.outside_current_mapping?.still_compliant === auditBeforeWrite.veritacomp.outside_current_mapping.still_compliant - compMoved.length && auditAfter.veritacheck?.from_draft_or_failed_study === auditBeforeWrite.veritacheck.from_draft_or_failed_study - 2, JSON.stringify([auditBeforeWrite.veritacomp.outside_current_mapping.still_compliant, auditAfter.veritacomp?.outside_current_mapping?.still_compliant, auditAfter.veritacheck?.from_draft_or_failed_study]));
    const afterWrite = allRows();
    const again = await dry();
    const secondWrite = await call("POST", ROUTE, { dryRun: false, expectedTotal: 0 }, admin);
    check("7. a second run finds nothing and changes nothing", again.total_to_move === 0 && secondWrite.s === 200 && secondWrite.j.changed === 0 && allRows() === afterWrite && audits() === 11, secondWrite.text.slice(0, 120));

    // 8. The edges
    const e1 = seed(DEMO, 80, "veritacomp_auto", COMP_NOTE), e2 = seed(DEMO, 81, "veritacomp_auto", COMP_NOTE);
    const plan = planMarkCorrection(sqlite).toMove;
    check("8. setup: two fresh marks are planned", plan.length === 2);
    sqlite.prepare("UPDATE veritascan_items SET notes = 'Typed after the plan' WHERE id = ?").run(e1);
    const applied = applyMarkCorrection(sqlite, plan, now);
    check("8. a row changed after the plan stays, and the other still moves", applied.length === 1 && applied[0].id === e2 && row(e1).status === "Compliant" && row(e1).notes === "Typed after the plan" && row(e2).status === "Not Assessed", JSON.stringify(applied.map((m: any) => m.id)));
    const e3 = seed(DEMO, 82, "veritacomp_auto", COMP_NOTE);
    const good = planMarkCorrection(sqlite).toMove.find((m: any) => m.id === e3)!;
    let threw = false;
    try { applyMarkCorrection(sqlite, [good, { ...good, id: {} as any }], now); } catch { threw = true; }
    check("8. a failure part way changes nothing: all of it or none of it", threw && row(e3).status === "Compliant", String(threw));
    const laterPass = mkStudy("pass", "precision", labA);
    autoCompleteVeritaScanItems({ id: laterPass, userId: ownerId, testName: "Made-up Sodium", studyType: "precision", labId: labA, status: "pass" });
    check("8. a later passing study links itself as evidence on a corrected item, and leaves the status to the lab", row(a30).status === "Not Assessed" && row(a30).completion_source === "veritacheck_evidence" && row(a30).completion_link === link(laterPass), JSON.stringify([row(a30).status, row(a30).completion_source, row(a30).completion_link]));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
