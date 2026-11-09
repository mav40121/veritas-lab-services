// tests/integration/competency-scan-items.test.ts
//
// Receipt for the site review's VeritaScan auto-completion findings (2026-11-05). A passing competency assessment marked
// VeritaScan items Compliant by a hard-coded list that no longer matched the catalog: waived marked director attestation
// and job descriptions, non-technical marked safety training and delegation of authority, technical marked signatures,
// remediation and infrequent-test QC. SCN-09: any saved study, a draft or a failed one included, marked its items too.
//   1. A passing waived or non-technical assessment, or a new-hire evaluation, marks no scan item.
//   2. A technical assessment marks item 60 only, and only when the record itself documents all six CLIA procedures, on the
//      first save or on the edit that fills them in.
//   3. The mark goes to the lab's own scans, never to another lab's. The program's own type decides, not the request.
//   4. An answer the lab changed on an auto-marked item stays, and the lab's own Compliant stays the lab's.
//   5. Draft and failed studies mark nothing. A passing study links itself as evidence (BUG-135: no status, the lab answers), and
//      so does a draft finished as a pass. tests/integration/veritacheck-scan-evidence.test.ts covers the coverage marks on 21 and 29.
//   6. GET /api/admin/veritascan/auto-completion-audit needs the admin secret, returns counts only and writes nothing.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:competency-scan-items

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { SCAN_ITEMS } from "../../client/src/lib/veritaScanData";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const DAY = "2026-10-15";
const NOTE_PREFIX = "Auto-completed by VeritaComp";

/** The six element rows of one method group, every element documented and passed. `change` adjusts one element's row. */
function sixElements(groupId: number, change: (el: number, row: any) => any = (_el, row) => row) {
  const data: Record<number, any> = {
    1: { el1SpecimenId: "SPEC-1" },
    2: { el2Evidence: "Worksheet reviewed", el2Date: DAY },
    3: { el3QcDate: DAY },
    4: { el4DateObserved: DAY },
    5: { el5SampleType: "PT", el5SampleId: "PT-1", el5Acceptable: true },
    6: { el6Score: 100, el6DateTaken: DAY },
  };
  return [1, 2, 3, 4, 5, 6].map((el) => change(el, { methodNumber: el, methodGroupId: groupId, elementNumber: el, methodGroupName: "Made-up method", passed: true, ...data[el] }));
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Scan", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  try {
    const q = (id: number) => SCAN_ITEMS.find((i) => i.id === id)?.question || "";
    check("0. the catalog still reads as this mapping assumes: item 60 is the six CLIA procedures", /all 6 required CLIA procedures/.test(q(60)), q(60).slice(0, 60));
    check("0. items 61 to 67 ask about something else", /signed by laboratory director/.test(q(61)) && /Remedial training/.test(q(62)) && /infrequently performed/.test(q(63)) && /attestation/.test(q(64)) && /Job descriptions/.test(q(65)) && /safety and regulatory training/.test(q(66)) && /Delegation of authority/.test(q(67)));

    const email = `scanitems-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Owner Madeup", hipaa_acknowledged: true });
    const T = reg.body.token as string;
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("UPDATE users SET plan = 'hospital' WHERE id = ?").run(userId); // the route without a lab in the URL reads the account's plan
    const labA =(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Lab A", plan: "hospital" })).body.labId as number;
    const L = `/api/labs/${labA}`;
    const mkLab = (name: string, isDemo: number) => Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, is_demo, created_at, updated_at) VALUES (?, ?, 'hospital', ?, ?, ?)").run(name, userId, isDemo, now, now).lastInsertRowid);
    const labB = mkLab("Made-up Lab B", 0);
    const directScan = (labId: number | null, name: string) => Number(sqlite.prepare("INSERT INTO veritascan_scans (user_id, lab_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(userId, labId, name, now, now).lastInsertRowid);

    // ── 6. The audit route, first, so the scratch DB holds only the rows below ──────────────────────────────────────
    const AUDIT = "/api/admin/veritascan/auto-completion-audit";
    const labX = mkLab("Audit Lab Named Xavier", 0);
    const labY = mkLab("Audit Lab Named Yolanda", 1);
    const scanX1 = directScan(labX, "Xavier scan one"), scanX2 = directScan(labX, "Xavier scan two");
    const scanY = directScan(labY, "Yolanda scan"), scanZ = directScan(null, "Legacy scan with no lab");
    const seed = (scanId: number, itemId: number, status: string, source: string, note: string | null, link: string | null = null) =>
      sqlite.prepare("INSERT INTO veritascan_items (scan_id, item_id, status, notes, completion_source, completion_link, completion_note, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(scanId, itemId, status, note, source, link, note, now);
    const oldNote = `${NOTE_PREFIX}™: technical assessment on 2026-01-05`;
    for (const item of [60, 61, 62, 63]) seed(scanX1, item, "Compliant", "veritacomp_auto", oldNote);
    seed(scanX1, 64, "Needs Attention", "veritacomp_auto", oldNote); // the lab already corrected this one
    seed(scanX1, 1, "Compliant", "manual", "Reviewed by the lab"); // the lab's own answer, not counted
    seed(scanX2, 61, "Compliant", "veritacomp_auto", oldNote);
    seed(scanX2, 65, "Compliant", "manual", oldNote); // the note alone identifies a mark
    seed(scanY, 66, "Compliant", "veritacomp_auto", oldNote);
    seed(scanZ, 67, "Compliant", "veritacomp_auto", oldNote);
    const mkStudy = (status: string) => Number(sqlite.prepare("INSERT INTO studies (test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at, user_id, lab_id) VALUES ('Made-up Sodium', 'A', 'Made Up', ?, 'cal_ver', 4, '[]', '[]', ?, ?, ?, ?)").run(DAY, status, now, userId, labX).lastInsertRowid);
    const checkNote = "Auto-completed by VeritaCheck®: Made-up Sodium on 2026-01-05";
    seed(scanX1, 21, "Compliant", "veritacheck_auto", checkNote, `/study/${mkStudy("fail")}/results`);
    seed(scanX1, 22, "Compliant", "veritacheck_auto", checkNote, `/study/${mkStudy("pass")}/results`);
    seed(scanY, 21, "Compliant", "veritacheck_auto", checkNote, `/study/${mkStudy("draft")}/results`);

    check("6a. the audit refuses no secret", (await call("GET", AUDIT)).status === 403);
    check("6a. the audit refuses a wrong secret", (await call("GET", AUDIT, undefined, undefined, undefined, { "x-admin-secret": "wrong" })).status === 403);
    check("6a. the audit refuses a signed-in owner", (await call("GET", AUDIT, undefined, T)).status === 403);
    check("6a. the audit refuses the secret in the URL", (await call("GET", `${AUDIT}?secret=${ADMIN}`)).status === 403);
    const changesBefore = (sqlite.prepare("SELECT total_changes() AS n").get() as any).n;
    const rowsBefore = JSON.stringify(sqlite.prepare("SELECT * FROM veritascan_items ORDER BY id").all());
    const audited = await call("GET", AUDIT, undefined, undefined, undefined, { "x-admin-secret": ADMIN });
    const a = audited.body;
    check("6b. the audit answers with the secret in the header", audited.status === 200 && a.ok === true, `HTTP ${audited.status}`);
    check("6b. the audit writes nothing", (sqlite.prepare("SELECT total_changes() AS n").get() as any).n === changesBefore && JSON.stringify(sqlite.prepare("SELECT * FROM veritascan_items ORDER BY id").all()) === rowsBefore);
    const leaves: unknown[] = [];
    const walk = (v: unknown) => { if (v && typeof v === "object") Object.values(v as object).forEach(walk); else leaves.push(v); };
    walk(a);
    check("6c. every value in the audit is a count or a flag, so it can't carry a name", leaves.length > 0 && leaves.every((v) => typeof v === "number" || typeof v === "boolean"), JSON.stringify(leaves.filter((v) => typeof v !== "number" && typeof v !== "boolean")));
    const text = JSON.stringify(a);
    check("6c. no lab, scan, owner, email or note text in the audit", !/Xavier|Yolanda|Madeup|Made-up|Legacy scan|example\.com|Auto-completed/.test(text));
    const c = a.veritacomp || {};
    check("6d. VeritaComp marks are counted by the source or the note, and the lab's own row is not", c.marks === 9, `marks=${c.marks}`);
    check("6d. a mark the lab already changed is not counted as still Compliant", c.still_compliant === 8, `still_compliant=${c.still_compliant}`);
    check("6d. labs, demo labs, scans and scans with no lab", c.labs === 2 && c.demo_labs === 1 && c.scans === 4 && c.scans_with_no_lab === 1, JSON.stringify({ labs: c.labs, demo: c.demo_labs, scans: c.scans, noLab: c.scans_with_no_lab }));
    const out = c.outside_current_mapping || {};
    check("6e. marks outside today's mapping leave out item 60", out.marks === 8 && out.still_compliant === 7 && out.labs === 2 && out.scans === 4, JSON.stringify(out));
    const byItem = (block: any, id: number) => (block.items || []).find((i: any) => i.item_id === id) || {};
    check("6f. the items are listed by item id", JSON.stringify((c.items || []).map((i: any) => i.item_id)) === JSON.stringify([60, 61, 62, 63, 64, 65, 66, 67]), JSON.stringify((c.items || []).map((i: any) => i.item_id)));
    check("6f. item 61: two marks in two scans of one lab", byItem(c, 61).marks === 2 && byItem(c, 61).still_compliant === 2 && byItem(c, 61).labs === 1 && byItem(c, 61).in_current_mapping === false, JSON.stringify(byItem(c, 61)));
    check("6f. item 60 is the one still in the mapping", byItem(c, 60).in_current_mapping === true && (c.items || []).filter((i: any) => i.in_current_mapping).length === 1);
    check("6f. item 64 shows the lab's correction", byItem(c, 64).marks === 1 && byItem(c, 64).still_compliant === 0);
    const v = a.veritacheck || {};
    check("6g. VeritaCheck marks are counted apart", v.marks === 3 && v.still_compliant === 3 && v.labs === 2 && byItem(v, 21).marks === 2 && byItem(v, 22).marks === 1, JSON.stringify({ marks: v.marks, labs: v.labs, items: v.items }));
    check("6g. marks resting on a draft or failed study are counted", v.from_draft_or_failed_study === 2, `from_draft_or_failed_study=${v.from_draft_or_failed_study}`);

    // ── The lab's scans ─────────────────────────────────────────────────────────────────────────────────────────────
    const freshScan = async () => Number((await call("POST", `${L}/veritascan/scans`, { name: `Made-up scan ${Math.random()}` }, T, labA)).body.id);
    const rowsOf = (scanId: number) => sqlite.prepare("SELECT item_id, status, completion_source, completion_note, completion_link FROM veritascan_items WHERE scan_id = ? ORDER BY item_id").all(scanId) as any[];
    const ids = (scanId: number) => rowsOf(scanId).map((r) => r.item_id);
    const emp = (await call("POST", `${L}/competency/employees`, { name: "Casey Madeup", title: "MLT", hireDate: "2020-01-05" }, T, labA)).body.id as number;
    const program = async (body: any) => Number((await call("POST", `${L}/competency/programs`, body, T, labA)).body.id);
    const groupsOf = (programId: number) => (sqlite.prepare("SELECT id FROM competency_method_groups WHERE program_id = ? ORDER BY id").all(programId) as any[]).map((g) => Number(g.id));
    const tech = await program({ name: "Made-up chemistry", department: "Chemistry", type: "technical", methodGroups: [{ name: "Made-up analyzer", instruments: ["Made-up analyzer"], analytes: ["Sodium"] }] });
    const techTwo = await program({ name: "Made-up two methods", department: "Hematology", type: "technical", methodGroups: [{ name: "Made-up counter", instruments: ["Made-up counter"], analytes: ["WBC"] }, { name: "Made-up manual diff", instruments: ["Made-up manual diff"], analytes: ["Diff"] }] });
    const waived = await program({ name: "Made-up waived", department: "Point of Care", type: "waived" });
    const nontech = await program({ name: "Made-up non-technical", department: "General", type: "nontechnical", checklistItems: [{ description: "Made-up item" }] });
    const evaluation = await program({ name: "Made-up evaluation", department: "General", type: "nontechnical", recordKind: "evaluation", checklistItems: [{ description: "Made-up item" }] });
    const [techGroup] = groupsOf(tech);
    const [g1, g2] = groupsOf(techTwo);
    const assess = (programId: number, competencyType: string, status: string, items: any[], assessmentType = "annual", route = `${L}/competency/assessments`) =>
      call("POST", route, { programId, employeeId: emp, assessmentType, assessmentDate: DAY, evaluatorName: "Made Up", competencyType, status, items }, T, labA);
    /** Runs one save against a brand-new scan and returns the items it marked. */
    let currentScan = 0;
    const scanOf = () => currentScan;
    const marksFrom = async (save: () => Promise<{ status: number; body: any }>) => {
      const scan = await freshScan();
      currentScan = scan;
      const r = await save();
      return { scan, r, ids: ids(scan) };
    };

    // ── 1. Waived, non-technical, evaluation ────────────────────────────────────────────────────────────────────────
    const waivedItems = [{ methodNumber: 2, waivedMethodNumber: 2, waivedEvidence: "Observed", waivedDate: DAY, waivedInitials: "MU", passed: true }, { methodNumber: 3, waivedMethodNumber: 3, waivedEvidence: "QC reviewed", waivedDate: DAY, waivedInitials: "MU", passed: true }];
    const w = await marksFrom(() => assess(waived, "waived", "pass", waivedItems));
    check("1. a passing waived assessment marks nothing (not 64 attestation or 65 job descriptions)", w.r.status === 200 && w.ids.length === 0, `HTTP ${w.r.status} items=${w.ids}`);
    const n = await marksFrom(() => assess(nontech, "nontechnical", "pass", []));
    check("1. a passing non-technical assessment marks nothing (not 66 safety training or 67 delegation)", n.r.status === 200 && n.ids.length === 0, `HTTP ${n.r.status} items=${n.ids}`);
    const e = await marksFrom(() => assess(evaluation, "nontechnical", "pass", [], "30day"));
    check("1. a new-hire evaluation marks nothing", e.r.status === 200 && e.ids.length === 0, `HTTP ${e.r.status} ${e.r.body.error ?? ""} items=${e.ids}`);

    // ── 2. Technical ────────────────────────────────────────────────────────────────────────────────────────────────
    const blank = await marksFrom(() => assess(tech, "technical", "pass", []));
    check("2a. a pass with no element documented marks nothing", blank.r.status === 200 && blank.ids.length === 0, `items=${blank.ids}`);
    const five = await marksFrom(() => assess(tech, "technical", "pass", sixElements(techGroup).filter((row) => row.elementNumber !== 4)));
    check("2a. a pass missing one of the six marks nothing", five.ids.length === 0, `items=${five.ids}`);
    const empty = await marksFrom(() => assess(tech, "technical", "pass", sixElements(techGroup, (el, row) => (el === 2 ? { methodNumber: el, methodGroupId: techGroup, elementNumber: el, passed: true } : row))));
    check("2a. a pass with one element left blank marks nothing", empty.ids.length === 0, `items=${empty.ids}`);
    const failedEl = await marksFrom(() => assess(tech, "technical", "pass", sixElements(techGroup, (el, row) => (el === 5 ? { ...row, passed: false } : row))));
    check("2a. a pass with a failed element marks nothing", failedEl.ids.length === 0, `items=${failedEl.ids}`);
    const naEl = await marksFrom(() => assess(tech, "technical", "pass", sixElements(techGroup, (el, row) => (el === 4 ? { methodNumber: el, methodGroupId: techGroup, elementNumber: el, passed: false, el4Na: true, el4NaJustification: "No user maintenance" } : row))));
    check("2a. an element N/A on the only method marks nothing: the record doesn't show that procedure", naEl.ids.length === 0, `items=${naEl.ids}`);
    const failed = await marksFrom(() => assess(tech, "technical", "fail", sixElements(techGroup)));
    const remediation = await marksFrom(() => assess(tech, "technical", "remediation", sixElements(techGroup)));
    check("2a. a failed record and a remediation record mark nothing", failed.ids.length === 0 && remediation.ids.length === 0, `fail=${failed.ids} remediation=${remediation.ids}`);
    const otherGroupNa = await marksFrom(() => assess(techTwo, "technical", "pass", [...sixElements(g1), ...sixElements(g2, (el, row) => (el === 4 ? { methodNumber: el, methodGroupId: g2, elementNumber: el, passed: false, el4Na: true, el4NaJustification: "Manual method, no maintenance" } : row))]));
    check("2b. N/A with a justification on one method is fine when another method on the record shows that procedure", otherGroupNa.ids.join() === "60", `items=${otherGroupNa.ids}`);
    const oneOfTwo = await marksFrom(() => assess(techTwo, "technical", "pass", sixElements(g1)));
    check("2b. a method on the program with no rows at all marks nothing", oneOfTwo.ids.length === 0, `items=${oneOfTwo.ids}`);

    const scanB = directScan(labB, "Lab B scan");
    const scanA2 = await freshScan();
    const full = await marksFrom(() => assess(tech, "technical", "pass", sixElements(techGroup)));
    check("2c. a fully documented technical pass marks item 60 and nothing else", full.r.status === 200 && full.ids.join() === "60", `HTTP ${full.r.status} ${full.r.body.error ?? ""} items=${full.ids}`);
    const mark = rowsOf(full.scan).find((r) => r.item_id === 60) || {};
    check("2c. the mark says where it came from", mark.status === "Compliant" && mark.completion_source === "veritacomp_auto" && mark.completion_link === "/veritacomp-app" && String(mark.completion_note).startsWith(NOTE_PREFIX), JSON.stringify(mark));
    check("2c. the note carries no em dash", !String(mark.completion_note).includes("—"));
    check("3. the other scan of the same lab gets it too", ids(scanA2).join() === "60", `items=${ids(scanA2)}`);
    check("3. another lab of the same owner gets nothing", ids(scanB).length === 0, `items=${ids(scanB)}`);
    const spoof = await marksFrom(() => assess(waived, "technical", "pass", [...waivedItems, ...sixElements(techGroup)]));
    check("3. the program's type decides: a waived program saying it is technical marks nothing", spoof.ids.length === 0, `items=${spoof.ids}`);
    const unsaid = await marksFrom(() => assess(tech, "", "pass", sixElements(techGroup)));
    check("3. a technical program with no type in the request still marks item 60", unsaid.ids.join() === "60", `items=${unsaid.ids}`);
    const saidWaived = await marksFrom(() => assess(tech, "waived", "pass", sixElements(techGroup)));
    check("3. and one whose request says waived", saidWaived.ids.join() === "60", `items=${saidWaived.ids}`);
    const legacySaidWaived = await marksFrom(() => assess(tech, "waived", "pass", sixElements(techGroup), "annual", "/api/competency/assessments"));
    check("3. the route without a lab in the URL too", legacySaidWaived.ids.join() === "60", `items=${legacySaidWaived.ids}`);
    const legacyBlank = await marksFrom(() => assess(tech, "technical", "pass", [], "annual", "/api/competency/assessments"));
    const legacyWaived = await marksFrom(() => assess(waived, "waived", "pass", waivedItems, "annual", "/api/competency/assessments"));
    const legacyFull = await marksFrom(() => assess(tech, "technical", "pass", sixElements(techGroup), "annual", "/api/competency/assessments"));
    check("3. the route without a lab in the URL follows the same rules", legacyBlank.ids.length === 0 && legacyWaived.ids.length === 0 && legacyFull.ids.join() === "60", `HTTP ${legacyFull.r.status} ${legacyFull.r.body.error ?? ""} blank=${legacyBlank.ids} waived=${legacyWaived.ids} full=${legacyFull.ids}`);

    // A record saved first and filled in later marks when it is filled in.
    const later = await marksFrom(async () => {
      const saved = await assess(tech, "technical", "pass", []);
      const blankIds = ids(scanOf());
      const edited = await call("PUT", `${L}/competency/assessments/${saved.body.id}`, { items: sixElements(techGroup) }, T, labA);
      return { status: edited.status, body: { ...edited.body, blankIds } };
    });
    check("2d. a pass saved blank marks nothing, and marks item 60 once an edit fills in all six", later.r.status === 200 && later.r.body.blankIds.length === 0 && later.ids.join() === "60", `HTTP ${later.r.status} ${later.r.body.error ?? ""} blank=${later.r.body.blankIds} after=${later.ids}`);
    const stillBlank = await marksFrom(async () => {
      const saved = await assess(tech, "technical", "pass", []);
      return call("PUT", `${L}/competency/assessments/${saved.body.id}`, { items: sixElements(techGroup).slice(0, 5) }, T, labA);
    });
    check("2d. an edit that leaves one blank marks nothing", stillBlank.r.status === 200 && stillBlank.ids.length === 0, `items=${stillBlank.ids}`);
    const failedThenFilled = await marksFrom(async () => {
      const saved = await assess(tech, "technical", "fail", []);
      return call("PUT", `${L}/competency/assessments/${saved.body.id}`, { items: sixElements(techGroup) }, T, labA);
    });
    check("2d. a failed record filled in stays unmarked", failedThenFilled.r.status === 200 && failedThenFilled.ids.length === 0, `items=${failedThenFilled.ids}`);
    // The account-level edit route refuses an owner with more than one lab, so it gets an owner with one.
    const soloEmail = `scanitems-solo-${Date.now()}@example.com`;
    const solo = (await call("POST", "/api/auth/register", { email: soloEmail, password: PW, name: "Solo Madeup", hipaa_acknowledged: true })).body.token as string;
    const soloLab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: soloEmail, labName: "Made-up Solo Lab", plan: "hospital" })).body.labId as number;
    const SL = `/api/labs/${soloLab}`;
    const soloScan = Number((await call("POST", `${SL}/veritascan/scans`, { name: "Made-up solo scan" }, solo, soloLab)).body.id);
    const soloEmp = (await call("POST", `${SL}/competency/employees`, { name: "Sam Madeup", title: "MLT", hireDate: "2020-01-05" }, solo, soloLab)).body.id as number;
    const soloProgram = Number((await call("POST", `${SL}/competency/programs`, { name: "Made-up solo chemistry", department: "Chemistry", type: "technical", methodGroups: [{ name: "Made-up analyzer", instruments: ["Made-up analyzer"], analytes: ["Sodium"] }] }, solo, soloLab)).body.id);
    const soloSaved = await call("POST", `${SL}/competency/assessments`, { programId: soloProgram, employeeId: soloEmp, assessmentType: "annual", assessmentDate: DAY, evaluatorName: "Made Up", competencyType: "technical", status: "pass", items: [] }, solo, soloLab);
    const soloBlank = ids(soloScan);
    const soloEdit = await call("PUT", `/api/competency/assessments/${soloSaved.body.id}`, { items: sixElements(groupsOf(soloProgram)[0]) }, solo, soloLab);
    check("2d. the edit route without a lab in the URL marks it too", soloBlank.length === 0 && soloEdit.status === 200 && ids(soloScan).join() === "60", `HTTP ${soloEdit.status} ${soloEdit.body.error ?? ""} blank=${soloBlank} after=${ids(soloScan)}`);

    // ── 4. The lab's own answer ─────────────────────────────────────────────────────────────────────────────────────
    const own = await marksFrom(() => assess(tech, "technical", "pass", sixElements(techGroup)));
    const saveItem = (scan: number, status: string) => call("PUT", `${L}/veritascan/scans/${scan}/items/60`, { status, notes: "The lab's own note" }, T, labA);
    const changed = await saveItem(own.scan, "Needs Attention");
    check("4. setup: the lab changes the marked item on the screen", changed.status === 200 && rowsOf(own.scan)[0]?.status === "Needs Attention", `HTTP ${changed.status}`);
    await assess(tech, "technical", "pass", sixElements(techGroup));
    check("4. the next passing assessment leaves the lab's Needs Attention", rowsOf(own.scan)[0]?.status === "Needs Attention", rowsOf(own.scan)[0]?.status);
    await saveItem(own.scan, "N/A");
    await assess(tech, "technical", "pass", sixElements(techGroup));
    check("4. and the lab's N/A", rowsOf(own.scan)[0]?.status === "N/A", rowsOf(own.scan)[0]?.status);
    const manual = await freshScan();
    await saveItem(manual, "Compliant");
    const manualBefore = rowsOf(manual)[0];
    await assess(tech, "technical", "pass", sixElements(techGroup));
    check("4. and a Compliant the lab entered itself stays the lab's", rowsOf(manual)[0]?.completion_source === manualBefore.completion_source && rowsOf(manual)[0]?.completion_source !== "veritacomp_auto", `${manualBefore.completion_source} -> ${rowsOf(manual)[0]?.completion_source}`);

    // ── 5. Studies (SCN-09) ─────────────────────────────────────────────────────────────────────────────────────────
    const study = (dp: Array<[number, number]>, extra: any = {}) => ({
      testName: "Made-up Sodium", instrument: "Made-up analyzer", analyst: "Made Up", date: DAY, studyType: "cal_ver", cliaAllowableError: 4, teaIsPercentage: 0, teaUnit: "mmol/L",
      dataPoints: JSON.stringify(dp.map(([expected, seen], i) => ({ level: i + 1, expectedValue: expected, instrumentValues: { "Made-up analyzer": seen } }))), instruments: JSON.stringify(["Made-up analyzer"]),
      status: "completed", createdAt: now, ...extra,
    });
    const good: Array<[number, number]> = [[120, 121], [140, 139], [160, 161]];
    const bad: Array<[number, number]> = [[120, 150], [140, 190], [160, 90]];
    const statusOf = (id: number) => (sqlite.prepare("SELECT status FROM studies WHERE id = ?").get(id) as any)?.status;
    const S = `${L}/studies`;
    const draft = await marksFrom(() => call("POST", S, { status: "draft", testName: "Made-up Sodium", studyType: "cal_ver" }, T, labA));
    check("5a. a saved draft marks nothing", draft.r.status === 200 && statusOf(draft.r.body.id) === "draft" && draft.ids.length === 0, `HTTP ${draft.r.status} items=${draft.ids}`);
    const failStudy = await marksFrom(() => call("POST", S, study(bad), T, labA));
    check("5a. a failed study marks nothing", failStudy.r.status === 200 && statusOf(failStudy.r.body.id) === "fail" && failStudy.ids.length === 0, `HTTP ${failStudy.r.status} ${statusOf(failStudy.r.body.id)} items=${failStudy.ids}`);
    const passStudy = await marksFrom(() => call("POST", S, study(good), T, labA));
    check("5b. a passing study links itself as evidence on its items and marks none Compliant", passStudy.r.status === 200 && statusOf(passStudy.r.body.id) === "pass" && passStudy.ids.length > 0 && rowsOf(passStudy.scan).every((r) => r.status === "Not Assessed" && r.completion_source === "veritacheck_evidence" && r.completion_link === `/study/${passStudy.r.body.id}/results`), `HTTP ${passStudy.r.status} items=${passStudy.ids}`);
    const finished = await marksFrom(() => call("PUT", `${S}/${draft.r.body.id}`, study(good), T, labA));
    check("5c. a draft finished as a pass links its items then", finished.r.status === 200 && statusOf(draft.r.body.id) === "pass" && finished.ids.length > 0, `HTTP ${finished.r.status} ${finished.r.body.error ?? ""} items=${finished.ids}`);
    const reEdit = await marksFrom(() => call("PUT", `${S}/${draft.r.body.id}`, study(good), T, labA));
    check("5c. editing a study that had already passed doesn't link again", reEdit.r.status === 200 && reEdit.ids.length === 0, `items=${reEdit.ids}`);
    const failEdit = await marksFrom(() => call("PUT", `${S}/${failStudy.r.body.id}`, study(bad), T, labA));
    check("5c. a failed study saved again as a fail marks nothing", failEdit.r.status === 200 && failEdit.ids.length === 0, `items=${failEdit.ids}`);
    const legacyDraft = await marksFrom(() => call("POST", "/api/studies", { status: "draft", testName: "Made-up Sodium", studyType: "cal_ver" }, T, labA));
    check("5d. the route without a lab in the URL: a draft marks nothing", legacyDraft.r.status < 300 && legacyDraft.ids.length === 0, `HTTP ${legacyDraft.r.status} items=${legacyDraft.ids}`);
    const legacyFail = await marksFrom(() => call("POST", "/api/studies", study(bad), T, labA));
    check("5d. a failed study marks nothing", legacyFail.r.status < 300 && legacyFail.ids.length === 0, `HTTP ${legacyFail.r.status} items=${legacyFail.ids}`);
    const legacyPass = await marksFrom(() => call("POST", "/api/studies", study(good), T, labA));
    const evidenceOnly = (scan: number) => rowsOf(scan).every((r) => r.status === "Not Assessed" && r.completion_source === "veritacheck_evidence");
    check("5d. a passing study links its items as evidence", legacyPass.r.status < 300 && legacyPass.ids.length > 0 && evidenceOnly(legacyPass.scan), `HTTP ${legacyPass.r.status} ${JSON.stringify(legacyPass.r.body.error ?? "")} items=${legacyPass.ids}`);
    const legacyFinish = await marksFrom(() => call("PUT", `/api/studies/${legacyDraft.r.body.id}`, study(good), T, labA));
    check("5d. a draft finished as a pass links its items as evidence", legacyFinish.r.status === 200 && legacyFinish.ids.length > 0 && evidenceOnly(legacyFinish.scan), `HTTP ${legacyFinish.r.status} ${JSON.stringify(legacyFinish.r.body.error ?? "")} items=${legacyFinish.ids}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
