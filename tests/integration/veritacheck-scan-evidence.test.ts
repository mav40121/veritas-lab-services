// tests/integration/veritacheck-scan-evidence.test.ts
//
// BUG-135 (Michael 2026-11-09, Q246 = 1). One passing sodium study marked VeritaScan item 21 ("calibration verification performed
// at least every 6 months for all nonwaived tests") Compliant in every scan of the lab. Now a passing study links itself as evidence
// and the status is the lab's; items 21 and 29 are marked only while VeritaCheck Coverage shows the whole lab current.
//   1. A passing cal_ver study puts evidence on 21 to 24 and sets no Compliant, in its own lab's scans only.
//   2. A draft or a failed study does nothing.
//   3. The lab's own answers are untouched, byte for byte.
//   4. Item 21 stays unmarked while one nonwaived test on the map lacks a current signed passing study, and is marked when all are.
//   5. Item 29 the same; a lab with no test on more than one instrument never gets 29; a scan with no lab never gets either.
//   6. Signing a draft that passes runs the marking: single sign-off and a Sign-off Group; a draft that fails on signing does nothing.
//   7. A lapse moves our coverage mark back with the link kept: at the next pass, and in the daily re-check.
//   8. The correction route's dry run counts the new category, expectedTotal is enforced, and the apply moves exactly those rows.
// Boots the REAL routes on a scratch DB with made-up rows only. Run: npm run test:veritacheck-scan-evidence
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const SECRET = process.env.ADMIN_SECRET || "test-admin-secret";
const ALPHA = "Alpha Chem 100", BETA = "Beta Chem 200", GAMMA = "Gamma Chem 300";
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const OLD = daysAgo(10), NEW = daysAgo(2);
const OLD_NOTE = "Auto-completed by VeritaCheck®: Made-up Sodium on 2026-01-05";
const hasEmDash = (s: string) => s.includes(String.fromCharCode(0x2014));

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { COVERAGE_NOTE_PREFIX, EVIDENCE_SOURCE, recheckCoverageScanMarks, labCoverageForScan } = await import("../../server/integrations");
  const { planMarkCorrection, correctionNote, CORRECTED_SOURCE } = await import("../../server/veritascanMarkCorrection");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };

  try {
    // ── Setup: made-up labs, maps and scans ─────────────────────────────────────────────────────────────────────────
    const email = `scanevidence-${Date.now()}@example.test`;
    const T = (await call("POST", "/api/auth/register", { email, password: ["Scan", "evid", "77!"].join("-"), name: "Owner Madeup", hipaa_acknowledged: true })).j.token as string;
    const ownerId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const provision = async (labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: SECRET, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const labA = await provision("Made-up Evidence Lab A"), labC = await provision("Made-up Single Analyzer Lab C"), labD = await provision("Made-up No Map Lab D");
    const labB = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES ('Made-up Lab B', ?, 'hospital', ?, ?)").run(ownerId, now, now).lastInsertRowid);
    const labE = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES ('Made-up Lab E', ?, 'hospital', ?, ?)").run(ownerId, now, now).lastInsertRowid);
    const map = (labId: number, instruments: Array<[string, Array<[string, string]>]>) => {
      const mapId = Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, 'Made-up map', ?, ?)").run(ownerId, labId, now, now).lastInsertRowid);
      for (const [name, tests] of instruments) {
        const id = Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, created_at) VALUES (?, ?, ?)").run(mapId, name, now).lastInsertRowid);
        for (const [analyte, complexity] of tests) sqlite.prepare("INSERT INTO veritamap_instrument_tests (instrument_id, map_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, 'Chemistry', ?, 1)").run(id, mapId, analyte, complexity);
      }
    };
    // Lab A: Sodium on two analyzers (needs a correlation), Potassium on one, and a waived glucose that needs neither.
    map(labA, [[ALPHA, [["Sodium", "MODERATE"], ["Potassium", "MODERATE"], ["Glucose", "WAIVED"]]], [BETA, [["Sodium", "MODERATE"]]]]);
    map(labC, [[ALPHA, [["Sodium", "MODERATE"]]]]); // Lab C: one analyzer, so no correlation is ever needed
    const routeScan = async (labId: number, name: string) => Number((await call("POST", `/api/labs/${labId}/veritascan/scans`, { name }, T, labId)).j.id);
    const directScan = (labId: number | null, name: string) => Number(sqlite.prepare("INSERT INTO veritascan_scans (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(ownerId, labId, name, now, now).lastInsertRowid);
    const SA = await routeScan(labA, "Made-up scan A"), SA2 = await routeScan(labA, "Made-up scan A, the lab's answers"), SC = await routeScan(labC, "Made-up scan C");
    const SB = directScan(labB, "Made-up scan B"), NOLAB = directScan(null, "Made-up legacy scan");
    const answer = (labId: number, scan: number, item: number, status: string) => call("PUT", `/api/labs/${labId}/veritascan/scans/${scan}/items/${item}`, { status, notes: "Our own review" }, T, labId);
    for (const [item, status] of [[21, "Needs Attention"], [22, "Needs Attention"], [23, "Compliant"], [24, "N/A"], [29, "N/A"]] as const) await answer(labA, SA2, item, status);
    const row = (scan: number, item: number) => sqlite.prepare("SELECT * FROM veritascan_items WHERE scan_id = ? AND item_id = ?").get(scan, item) as any;
    const rowsOf = (scan: number) => sqlite.prepare("SELECT * FROM veritascan_items WHERE scan_id = ? ORDER BY item_id").all(scan) as any[];
    const snap = (...scans: number[]) => JSON.stringify(scans.map(rowsOf));
    const ANSWERED = [21, 22, 23, 24, 29];
    const labAnswers = () => JSON.stringify(ANSWERED.map((i) => row(SA2, i))); // the rows the lab answered; evidence may add rows it never answered
    const labOwn = labAnswers();
    const link = (id: number) => `/study/${id}/results`;
    const isEvidence = (r: any, studyId: number) => !!r && r.status === "Not Assessed" && r.completion_source === EVIDENCE_SOURCE && r.completion_link === link(studyId);
    const isCoverageMark = (r: any) => !!r && r.status === "Compliant" && r.completion_source === "veritacheck_auto" && String(r.completion_note).startsWith(COVERAGE_NOTE_PREFIX);
    const coverage = (labId: number) => labCoverageForScan(sqlite, labId).summary;

    const points = (insts: string[], dp: Array<[number, number]>) => dp.map(([expected, seen], i) => ({ level: i + 1, expectedValue: expected, instrumentValues: Object.fromEntries(insts.map((n) => [n, seen])) }));
    const good: Array<[number, number]> = [[120, 121], [140, 139], [160, 161]];
    const bad: Array<[number, number]> = [[120, 150], [140, 190], [160, 90]];
    const calVer = (testName: string, instrument: string, date: string, dp = good) => ({
      testName, instrument, analyst: "Made Up", date, studyType: "cal_ver", cliaAllowableError: 4, teaIsPercentage: 0, teaUnit: "mmol/L",
      dataPoints: JSON.stringify(points([instrument], dp)), instruments: JSON.stringify([instrument]), status: "completed", createdAt: now,
    });
    const correlation = (testName: string, insts: string[], date: string) => ({
      testName, instrument: insts.join(" / "), analyst: "Made Up", date, studyType: "method_comparison", cliaAllowableError: 4, teaIsPercentage: 0, teaUnit: "mmol/L",
      dataPoints: JSON.stringify([140, 141, 142, 143, 144].map((v, i) => ({ level: i + 1, instrumentValues: Object.fromEntries(insts.map((n, k) => [n, v + k * 0.5])) }))),
      instruments: JSON.stringify(insts), status: "completed", createdAt: now,
    });
    const save = async (labId: number, body: any) => { const r = await call("POST", `/api/labs/${labId}/studies`, body, T, labId); return { ...r, id: Number(r.j.id) }; };
    const statusOf = (id: number) => (sqlite.prepare("SELECT status, lifecycle_state FROM studies WHERE id = ?").get(id) as any);
    const sign = (labId: number, id: number) => call("POST", `/api/labs/${labId}/studies/${id}/finalize`, { signature: "Made Up" }, T, labId);

    // ── 1. A passing study links itself as evidence ─────────────────────────────────────────────────────────────────
    const s1 = await save(labA, calVer("Sodium", ALPHA, OLD));
    check("1. setup: the sodium study on Alpha passes", s1.s === 200 && statusOf(s1.id)?.status === "pass", `HTTP ${s1.s} ${s1.text.slice(0, 120)}`);
    check("1. it links itself as evidence on items 21 to 24", [21, 22, 23, 24].every((i) => isEvidence(row(SA, i), s1.id)), JSON.stringify([21, 22, 23, 24].map((i) => row(SA, i))));
    check("1. the evidence note says what it is", String(row(SA, 21)?.completion_note).startsWith("Evidence from VeritaCheck®: a passing Sodium study on ") && !hasEmDash(String(row(SA, 21)?.completion_note)), row(SA, 21)?.completion_note);
    check("1. no item in the scan reads Compliant", rowsOf(SA).every((r) => r.status !== "Compliant"), JSON.stringify(rowsOf(SA).map((r) => [r.item_id, r.status])));
    check("1. the lab's notes box stays empty: the note is on the evidence, not in the lab's words", rowsOf(SA).every((r) => r.notes === null));
    check("1. another lab of the same owner, and a scan with no lab, get nothing", rowsOf(SB).length === 0 && rowsOf(NOLAB).length === 0, `B=${rowsOf(SB).length} none=${rowsOf(NOLAB).length}`);

    // ── 2. A draft or a failed study does nothing ───────────────────────────────────────────────────────────────────
    const beforeDraft = snap(SA, SA2, SB, NOLAB);
    const draft = await save(labA, { status: "draft", testName: "Sodium", studyType: "cal_ver" });
    check("2. a saved draft does nothing", draft.s === 200 && statusOf(draft.id)?.status === "draft" && snap(SA, SA2, SB, NOLAB) === beforeDraft, `HTTP ${draft.s}`);
    const failed = await save(labA, calVer("Sodium", ALPHA, OLD, bad));
    check("2. a failed study does nothing", failed.s === 200 && statusOf(failed.id)?.status === "fail" && snap(SA, SA2, SB, NOLAB) === beforeDraft, `HTTP ${failed.s} ${statusOf(failed.id)?.status}`);
    sqlite.prepare("UPDATE studies SET archived_at = ? WHERE id IN (?, ?)").run(now, draft.id, failed.id); // out of the coverage picture from here on

    // ── 3. The lab's own answers ────────────────────────────────────────────────────────────────────────────────────
    check("3. the lab's own Needs Attention, Compliant and N/A are untouched, byte for byte", labAnswers() === labOwn, labAnswers().slice(0, 300));

    // ── 4. Item 21 follows the lab's coverage ───────────────────────────────────────────────────────────────────────
    check("4. setup: signing the sodium study on Alpha", (await sign(labA, s1.id)).s === 200 && statusOf(s1.id)?.lifecycle_state === "finalized");
    check("4. one signed test of three: item 21 stays unmarked", !isCoverageMark(row(SA, 21)) && row(SA, 21)?.status === "Not Assessed" && coverage(labA).linearityCovered === 1 && coverage(labA).linearityMissing + coverage(labA).linearityReview === 2, JSON.stringify(coverage(labA)));
    const s2 = await save(labA, calVer("Potassium", ALPHA, OLD));
    await sign(labA, s2.id);
    const s3 = await save(labA, calVer("Sodium", BETA, OLD));
    const cov4 = coverage(labA);
    check("4. sodium on Beta passed but isn't signed: item 21 still unmarked", statusOf(s3.id)?.status === "pass" && cov4.linearityMissing === 1 && cov4.linearityCovered === 2 && row(SA, 21)?.status === "Not Assessed", JSON.stringify(cov4));
    check("4. the waived glucose is not required", cov4.linearityExempt === 1 && cov4.linearityRequired === 3, JSON.stringify(cov4));
    check("4. setup: signing sodium on Beta", (await sign(labA, s3.id)).s === 200);
    const m21 = row(SA, 21);
    check("4. every nonwaived test signed and current: item 21 is marked Compliant from coverage", isCoverageMark(m21), JSON.stringify(m21));
    check("4. the mark keeps the latest study as its link, and names the basis and the date", m21?.completion_link === link(s3.id) && String(m21?.completion_note).includes("(3 of 3)") && /on \d{4}-\d{2}-\d{2}:/.test(String(m21?.completion_note)) && !hasEmDash(String(m21?.completion_note)), m21?.completion_note);
    check("4. items 22 to 24 stay evidence: coverage marks only 21 and 29", [22, 23, 24].every((i) => row(SA, i)?.status === "Not Assessed" && row(SA, i)?.completion_source === EVIDENCE_SOURCE));
    check("4. the lab's own answer on 21 stays", labAnswers() === labOwn);
    check("4. a scan with no lab, and another lab, never get the coverage mark", rowsOf(NOLAB).every((r) => r.status !== "Compliant") && rowsOf(SB).length === 0);
    check("4. no correlation yet: item 29 unmarked", !isCoverageMark(row(SA, 29)) && coverage(labA).methodComparisonsNeeded === 1 && coverage(labA).methodComparisonsDone === 0);

    // ── 5. Item 29 ──────────────────────────────────────────────────────────────────────────────────────────────────
    const s4 = await save(labA, correlation("Sodium", [ALPHA, BETA], OLD));
    check("5. setup: the sodium correlation passes", statusOf(s4.id)?.status === "pass", `${s4.s} ${s4.text.slice(0, 160)}`);
    check("5. unsigned: it is evidence on 26 to 29 and 29 is unmarked", [26, 27, 28, 29].every((i) => isEvidence(row(SA, i), s4.id)), JSON.stringify(row(SA, 29)));
    await sign(labA, s4.id);
    check("5. signed: every test on two analyzers has a current correlation, so 29 is marked", isCoverageMark(row(SA, 29)) && row(SA, 29)?.completion_link === link(s4.id) && String(row(SA, 29)?.completion_note).includes("(1 of 1)"), JSON.stringify(row(SA, 29)));
    check("5. the lab's own N/A on 29 stays", labAnswers() === labOwn);
    const c1 = await save(labC, calVer("Sodium", ALPHA, OLD));
    await sign(labC, c1.id);
    check("5. lab C: its one test signed, item 21 is marked", isCoverageMark(row(SC, 21)), JSON.stringify(row(SC, 21)));
    const c2 = await save(labC, correlation("Sodium", [ALPHA, GAMMA], OLD));
    await sign(labC, c2.id);
    recheckCoverageScanMarks();
    check("5. lab C has no test on two analyzers on its map: a signed passing correlation never marks 29", coverage(labC).methodComparisonsNeeded === 0 && isEvidence(row(SC, 29), c2.id), JSON.stringify(row(SC, 29)));

    // ── 6. Signing a draft that passes runs the marking ─────────────────────────────────────────────────────────────
    const draftRow = (testName: string, dp: Array<[number, number]>) => Number(sqlite.prepare(
      "INSERT INTO studies (test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, data_points, instruments, status, lifecycle_state, created_at, user_id, lab_id) VALUES (?, ?, 'Made Up', ?, 'cal_ver', 4, 0, ?, ?, 'draft', 'draft', ?, ?, ?)"
    ).run(testName, ALPHA, OLD, JSON.stringify(points([ALPHA], dp)), JSON.stringify([ALPHA]), now, ownerId, labD).lastInsertRowid);
    const SD = await routeScan(labD, "Made-up scan D");
    const d1 = draftRow("Chloride", good);
    const signedD1 = await sign(labD, d1);
    check("6. signing a draft that passes: it reads pass", signedD1.s === 200 && statusOf(d1)?.status === "pass", `HTTP ${signedD1.s} ${statusOf(d1)?.status}`);
    check("6. and links itself as evidence on 21 to 24, with nothing Compliant (lab D has no map)", [21, 22, 23, 24].every((i) => isEvidence(row(SD, i), d1)) && rowsOf(SD).every((r) => r.status !== "Compliant"), JSON.stringify(rowsOf(SD).map((r) => [r.item_id, r.status, r.completion_source])));
    const SD2 = await routeScan(labD, "Made-up scan D two");
    const d2 = draftRow("Chloride", bad);
    await sign(labD, d2);
    check("6. a draft that fails on signing links nothing", statusOf(d2)?.status === "fail" && rowsOf(SD2).length === 0, `${statusOf(d2)?.status} rows=${rowsOf(SD2).length}`);
    const SD3 = await routeScan(labD, "Made-up scan D three");
    const d3 = draftRow("Chloride", good);
    const group = Number((await call("POST", `/api/labs/${labD}/veritacheck/signoff-groups`, { name: "Made-up group" }, T, labD)).j.id);
    await call("POST", `/api/labs/${labD}/veritacheck/signoff-groups/${group}/studies`, { studyIds: [d3] }, T, labD);
    const groupSign = await call("POST", `/api/labs/${labD}/veritacheck/signoff-groups/${group}/sign`, { signature: "Made Up" }, T, labD);
    check("6. a Sign-off Group sign runs the same marking", groupSign.s === 200 && groupSign.j.signed === 1 && [21, 22, 23, 24].every((i) => isEvidence(row(SD3, i), d3)), `HTTP ${groupSign.s} ${JSON.stringify(row(SD3, 21))}`);

    // ── 7. Lapse ────────────────────────────────────────────────────────────────────────────────────────────────────
    const s5 = await save(labA, calVer("Potassium", ALPHA, NEW)); // newer and unsigned, so potassium on Alpha is owed again
    const l21 = row(SA, 21);
    check("7. a newer unsigned study at the next pass: our mark on 21 goes back to Not Assessed", l21?.status === "Not Assessed" && l21?.completion_source === EVIDENCE_SOURCE, JSON.stringify(l21));
    check("7. the study link stays as evidence (the latest passing study) and the note says why", l21?.completion_link === link(s5.id) && /no longer shows every nonwaived test/.test(String(l21?.completion_note)) && /The study stays linked as evidence/.test(String(l21?.completion_note)) && !hasEmDash(String(l21?.completion_note)), l21?.completion_note);
    check("7. item 29 still stands, and the lab's own answers are untouched", isCoverageMark(row(SA, 29)) && labAnswers() === labOwn);
    const markC = JSON.stringify(row(SC, 21));
    const old = new Date(Date.now() - 220 * 86400000).toISOString();
    sqlite.prepare("UPDATE studies SET date = ?, finalized_at = ? WHERE id = ?").run(old.slice(0, 10), old, s4.id); // the correlation is now 7 months old
    const daily = recheckCoverageScanMarks();
    const l29 = row(SA, 29);
    check("7. the daily re-check finds the lapsed correlation and moves 29 back", daily.lapsed === 1 && daily.errors === 0 && l29?.status === "Not Assessed" && l29?.completion_source === EVIDENCE_SOURCE && l29?.completion_link === link(s4.id), `${JSON.stringify(daily)} ${JSON.stringify(l29)}`);
    check("7. its note says why", /no longer shows a current signed, passing correlation/.test(String(l29?.completion_note)), l29?.completion_note);
    check("7. a lab whose coverage still holds keeps its mark byte for byte", JSON.stringify(row(SC, 21)) === markC);
    await sign(labA, s5.id);
    check("7. signing the newer study marks 21 again, with its link", isCoverageMark(row(SA, 21)) && row(SA, 21)?.completion_link === link(s5.id), JSON.stringify(row(SA, 21)));
    check("7. and 29 stays back while its correlation is overdue", row(SA, 29)?.status === "Not Assessed");

    // ── 8. The correction route ─────────────────────────────────────────────────────────────────────────────────────
    const ROUTE = "/api/admin/veritascan/correct-auto-marks";
    const adminCall = (body: unknown) => call("POST", ROUTE, body, undefined, undefined, { "x-admin-secret": SECRET });
    const mkStudy = (status: string, type: string, labId: number) => Number(sqlite.prepare(
      "INSERT INTO studies (test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, user_id, lab_id) VALUES ('Made-up Sodium', 'A', 'Made Up', '2026-01-05', ?, 4, '[]', '[]', ?, ?, ?, ?)"
    ).run(type, status, now, ownerId, labId).lastInsertRowid);
    const seed = (scan: number, item: number, studyId: number, opts: { notes?: string; owner?: string } = {}) => Number(sqlite.prepare(
      "INSERT INTO veritascan_items (scan_id, item_id, status, notes, owner, completion_source, completion_link, completion_note, updated_at) VALUES (?, ?, 'Compliant', ?, ?, 'veritacheck_auto', ?, ?, '2026-01-05T12:00:00.000Z')"
    ).run(scan, item, opts.notes ?? OLD_NOTE, opts.owner ?? null, link(studyId), OLD_NOTE).lastInsertRowid);
    const SE = directScan(labE, "Made-up scan E"), SA3 = directScan(labA, "Made-up scan A three");
    const pE = mkStudy("pass", "cal_ver", labE), pPrec = mkStudy("pass", "precision", labE), fE = mkStudy("fail", "cal_ver", labE);
    const e21 = seed(SE, 21, pE), e22 = seed(SE, 22, pE), e30 = seed(SE, 30, pPrec);           // move: lab E has no coverage
    const e23 = seed(SE, 23, pE, { notes: "Our own words" }), e24 = seed(SE, 24, pE, { owner: "Made-up Owner" }); // the lab's work: stay
    const e26 = seed(SE, 26, fE);                                                               // the existing category: a failed study
    const a21 = seed(SA3, 21, s1.id);                                                           // stays: lab A's coverage for 21 is complete
    const a29 = seed(SA3, 29, s4.id), a27 = seed(SA3, 27, s4.id);                               // move: 29's coverage lapsed; 27 is never marked
    const n21 = seed(NOLAB, 21, pE);                                                            // moves: a scan with no lab never has coverage
    const passingMoves = [e21, e22, e30, a29, a27, n21], stays = [e23, e24, a21];
    const rowById = (id: number) => sqlite.prepare("SELECT * FROM veritascan_items WHERE id = ?").get(id) as any;
    const allRows = () => JSON.stringify(sqlite.prepare("SELECT * FROM veritascan_items ORDER BY id").all());
    const audits = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'veritascan_item'").get() as any).n);

    const before = allRows(), auditsBefore = audits();
    const dry = await adminCall({ dryRun: true });
    const p = dry.j.veritacheck_passing ?? {};
    check("8. the dry run answers and writes nothing", dry.s === 200 && dry.j.dryRun === true && allRows() === before && audits() === auditsBefore, dry.text.slice(0, 200));
    check("8. the new category counts the marks to move", p.to_move === passingMoves.length, JSON.stringify(p));
    const planned = planMarkCorrection(sqlite).toMove;
    check("8. exactly those rows are planned in it", JSON.stringify(planned.filter((m: any) => m.module === "veritacheck_passing").map((m: any) => m.id).sort((x: number, y: number) => x - y)) === JSON.stringify([...passingMoves].sort((x, y) => x - y)), JSON.stringify(planned.map((m: any) => [m.id, m.module])));
    check("8. the lab's work stays: a note of its own, an owner", p.left_alone?.lab_note_on_item === 1 && p.left_alone?.owner_due_or_teaching_note_set === 1, JSON.stringify(p.left_alone));
    check("8. item 21 on a lab whose coverage is complete is not touched (lab A's two coverage marks, lab C's, and the seeded one)", p.item_21_or_29_lab_coverage_complete_not_touched === 3, String(p.item_21_or_29_lab_coverage_complete_not_touched));
    check("8. the population adds up", p.from_passing_study_still_compliant === p.to_move + 2 + p.item_21_or_29_lab_coverage_complete_not_touched, JSON.stringify(p));
    check("8. the existing VeritaCheck category still takes the failed study's mark", dry.j.veritacheck?.to_move === 1 && planned.some((m: any) => m.id === e26 && m.module === "veritacheck"), JSON.stringify(dry.j.veritacheck));
    check("8. the total is both", dry.j.total_to_move === passingMoves.length + 1, String(dry.j.total_to_move));
    const labE_ = (dry.j.by_lab ?? []).find((x: any) => x.lab_id === labE) ?? {};
    check("8. per lab, with lab ids and no names", labE_.veritacheck_passing === 3 && labE_.veritacheck === 1 && labE_.left_alone === 2 && dry.j.scans_with_no_lab?.veritacheck_passing === 1 && !/Made-up|Madeup|example\.test|Our own/.test(dry.text), JSON.stringify(labE_));
    const wrong = await adminCall({ dryRun: false, expectedTotal: passingMoves.length });
    check("8. a write naming the wrong count is refused and writes nothing", wrong.s === 409 && wrong.j.code === "COUNT_CHANGED" && allRows() === before && audits() === auditsBefore, wrong.text.slice(0, 160));
    const untouched = Object.fromEntries(stays.map((id) => [id, JSON.stringify(rowById(id))]));
    const wrote = await adminCall({ dryRun: false, expectedTotal: passingMoves.length + 1 });
    check("8. the write with the dry run's count moves them all", wrote.s === 200 && wrote.j.changed === passingMoves.length + 1 && wrote.j.remaining === 0, wrote.text.slice(0, 200));
    const today = new Date().toISOString().slice(0, 10);
    check("8. a moved row reads Not Assessed and corrected, keeps its passing study's link, and says why", passingMoves.every((id) => {
      const r = rowById(id);
      return r.status === "Not Assessed" && r.completion_source === CORRECTED_SOURCE && /^\/study\/\d+\/results$/.test(String(r.completion_link)) && r.notes === correctionNote("veritacheck_passing", today) && r.completion_note === r.notes;
    }), JSON.stringify(rowById(e22)));
    check("8. the links are the same studies as before", rowById(e22).completion_link === link(pE) && rowById(e30).completion_link === link(pPrec) && rowById(a29).completion_link === link(s4.id));
    check("8. the note has no em dash and the right mark", !hasEmDash(correctionNote("veritacheck_passing", today)) && correctionNote("veritacheck_passing", today).includes("VeritaCheck®"));
    check("8. the failed study's mark loses its link, as before", rowById(e26).status === "Not Assessed" && rowById(e26).completion_link === null && rowById(e26).notes === correctionNote("veritacheck", today));
    check("8. the rows left alone are byte for byte the same", stays.every((id) => JSON.stringify(rowById(id)) === untouched[id]));
    check("8. the lab's own answers and the coverage marks are untouched", labAnswers() === labOwn && isCoverageMark(row(SA, 21)) && isCoverageMark(row(SC, 21)));
    check("8. each moved row has an audit row, and it records the kept link", audits() === auditsBefore + passingMoves.length + 1 && (() => {
      const a = sqlite.prepare("SELECT before_json, after_json FROM audit_log WHERE entity_type = 'veritascan_item' AND entity_id = ?").get(String(e22)) as any;
      return JSON.parse(a?.before_json ?? "{}").status === "Compliant" && JSON.parse(a?.after_json ?? "{}").completion_link === link(pE);
    })(), String(audits()));
    const again = await adminCall({ dryRun: true });
    check("8. a second dry run finds nothing", again.j.total_to_move === 0, String(again.j.total_to_move));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
