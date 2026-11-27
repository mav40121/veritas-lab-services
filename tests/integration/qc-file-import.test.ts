// tests/integration/qc-file-import.test.ts
//
// STANDING integration test for reading QC results from a file, and the sigma metric (B12, 2026-11-24; server/qcFileImport.ts,
// server/qcRuns.ts, server/qcSigma.ts, shared/qcImportRules.ts). On main before this every route under /qc/file-imports and /qc/sigma is a 404.
//   1. A typed run answers as it did: the same keys, rules, basis and stored rows for a scripted series with backdated runs.
//   2. Preview: each row's outcome with its reason, nothing stored, counts. Patient columns, cells and file names are refused by name.
//   3. Names: never matched for you; a choice is checked against this lab (another lab's analyzer id is refused) and kept for its own place.
//   4. Import: the counts and the file's hash are checked again (409); each run says where it came from; judged exactly as typed runs are.
//   5. The same file again stores nothing. A row dated before runs on file changes no stored verdict. A signed month's review never changes.
//   6. Taken back: voided runs only, with no corrective action and no review on them; the rest stay and are listed.
//   7. Excel: dates and times, formulas, numbers, sheets; a zone becomes the lab's clock; both wide layouts; limits.
//   8. Who may: a view-only seat reads the imports and the sigma metric and nothing else; a Staff login, another customer and Veritas
//      support (setup only) are refused. A retired or held lot takes rows dated on or before that day, typed and imported alike.
//   9. The sigma metric through the routes. 10. Export-all and the customer purge take every new table.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:qc-file-import

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { unclassifiedTables, exportContext, selectRecords } from "../../server/exportAll";
import { EXPORT_TABLES } from "../../server/exportAllTables";
import { applyCustomerPurge, planCustomerPurge, purgeRule, unruledTables } from "../../server/customerPurge";
import { buildMonthlyReviewPayload } from "../../server/qcMonthlyReviewPayload";
import { buildMonthlyReviewHTML } from "../../server/pdfQCMonthly";
import { computeLabReadiness } from "../../server/labReadiness";
import { wallClock } from "../../shared/qcImportRules";

(globalThis as any).require ??= createRequire(import.meta.url);
const require2 = createRequire(import.meta.url);
const ExcelJS = require2("exceljs");

let failures = 0;
function check(name: string, cond: boolean, detail: unknown = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : `  :: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Qc", "file", "88!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  type Up = { name: string; bytes: Buffer | string };
  const sendFile = async (p: string, file: Up | null, fields: Record<string, unknown>, token: string) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, typeof v === "string" ? v : JSON.stringify(v));
    if (file) fd.append("file", new Blob([new Uint8Array(Buffer.from(file.bytes as any))]), file.name);
    const r = await fetch(base + p, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const mkLab = async (tag: string, email = `qcimp-${tag}-${Date.now()}@example.com`) => {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: `Owner ${tag}`, hipaa_acknowledged: true });
    const prov = await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `QC Import Lab ${tag}`, plan: "hospital", isWarehouse: true });
    return { email, token: reg.body.token as string, labId: prov.body.labId as number, userId: Number(reg.body.user?.id ?? reg.body.id) };
  };
  const addPerson = async (lab: { labId: number; userId: number }, tag: string, kind: "editor" | "staff" | "viewer", name: string) => {
    const email = `qcimp-${tag}-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name, hipaa_acknowledged: true });
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?, 'staff','active',1,?,?,?)").run(lab.labId, userId, now, now, now);
    sqlite.prepare("UPDATE users SET lab_id = ? WHERE id = ?").run(lab.labId, userId);
    if (kind === "staff") {
      const sl = Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up', '99D0000000', ?, ?, ?)").run(lab.userId, lab.labId, now, now).lastInsertRowid);
      const emp = Number(sqlite.prepare("INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'Made', 'active', ?, ?)").run(sl, lab.labId, lab.userId, tag, now, now).lastInsertRowid);
      sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, status, seat_type, lab_id, staff_employee_id, permissions, invited_at, accepted_at) VALUES (?, ?, ?, 'active', 'staff_portal', ?, ?, '{"mode":"view_all"}', ?, ?)`).run(lab.userId, email, userId, lab.labId, emp, now, now);
    } else {
      sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'active')`)
        .run(lab.userId, email, userId, now, now, kind === "editor" ? '{"mode":"edit_all"}' : '{"mode":"view_all"}', `qcimp-${tag}-${Date.now()}`, lab.labId);
    }
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    return { email, userId, name, token: (await call("POST", "/api/auth/login", { email, password: PW })).body.token as string };
  };
  const lotIn = (labId: number, analyte: string, level: string, lot: string, mean: number, sd: number) =>
    Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(labId, analyte, level, lot, mean, sd, now, now).lastInsertRowid);
  const analyzerIn = (lab: { labId: number; userId: number }, name: string, nickname: string | null) => {
    const map = (sqlite.prepare("SELECT id FROM veritamap_maps WHERE lab_id = ?").get(lab.labId) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO veritamap_maps (user_id, lab_id, name, instruments, created_at, updated_at) VALUES (?, ?, 'Core lab', '[]', ?, ?)").run(lab.userId, lab.labId, now, now).lastInsertRowid);
    return Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, nickname, role, category, created_at) VALUES (?, ?, ?, 'Primary', 'Chemistry', ?)").run(map, name, nickname, now).lastInsertRowid);
  };

  try {
    const A = await mkLab("a"), T = await mkLab("typed"), X = await mkLab("x");
    sqlite.prepare("UPDATE labs SET is_demo = 0, time_zone = 'America/Los_Angeles' WHERE id IN (?, ?, ?)").run(A.labId, T.labId, X.labId);
    const editor = await addPerson(A, "editor", "editor", "Edie Editor");
    const staff = await addPerson(A, "staff", "staff", "Stan Stafford");
    const viewer = await addPerson(A, "viewer", "viewer", "Vic Viewer");
    const F = (lab: number) => `/api/labs/${lab}/qc/file-imports`;
    const L = F(A.labId);
    const count = (labId: number) => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM qc_results WHERE lab_id = ?").get(labId) as any).n);

    // ── 1. Typed runs answer as before (recorded on main at b949129a) ──
    const SERIES: Array<[string, number, string?]> = [["2026-09-01", 100.4], ["2026-09-02", 104.6], ["2026-09-03", 104.4], ["2026-09-05", 107.1], ["2026-09-04", 95.2, "06:10"], ["2026-09-05", 101, "05:00"], ["2026-09-06", 102.4], ["2026-09-07", 102.6], ["2026-09-08", 102.9], ["2026-09-09", 103.1], ["2026-09-01", 92], ["2026-09-10", 103.2], ["2026-09-11", 103.4], ["2026-09-12", 103.5], ["2026-09-13", 99], ["2026-09-14", 101.5], ["2026-09-15", 98.2], ["2026-09-16", 100], ["2026-09-17", 100.5], ["2026-09-18", 101.1], ["2026-09-19", 99.4], ["2026-09-20", 108.5], ["2026-09-21", 100.2], ["2026-09-10", 88]];
    const RECORDED = [["", "m", 100, 2], ["1-2s:1", "m", 100, 2], ["1-2s:2 2-2s:1.2", "m", 100, 2], ["1-3s:3 2-2s:2.3", "m", 100, 2], ["1-2s:4 R-4s:2.4", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["4-1s:6.7.8.9", "m", 100, 2], ["1-3s:10", "m", 100, 2], ["4-1s:7.8.9.11", "m", 100, 2], ["4-1s:8.9.11.12 7-T:5.6.7.8.9.11.12", "m", 100, 2], ["4-1s:9.11.12.13 7-T:6.7.8.9.11.12.13", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["", "m", 100, 2], ["", "e", 101.305, 3.3842], ["1-2s:21", "e", 101.2143, 3.3246], ["", "e", 101.5455, 3.5972], ["1-3s:23", "m", 100, 2]];
    const tLot = lotIn(T.labId, "Glucose", "Low", "G1", 100, 2);
    const typed: any[] = [];
    for (const [d, v, t] of SERIES) typed.push(await call("POST", `/api/labs/${T.labId}/qc/results`, { control_lot_id: tLot, result_value: v, result_date: d, run_time: t ?? null, instrument: "Analyzer A" }, T.token));
    const id0 = typed[0].body.result_id;
    const got = typed.map((r) => [r.body.violations.map((x: any) => `${x.rule_code}:${x.related_result_ids.map((i: number) => i - id0).join(".")}`).join(" "), r.body.basis.source[0], Number(r.body.basis.mean.toFixed(4)), Number(r.body.basis.sd.toFixed(4))]);
    check("1. a typed run fires the same rules on the same basis as before, backdated ones too", JSON.stringify(got) === JSON.stringify(RECORDED), got);
    check("1. ... and answers with the same keys", JSON.stringify(Object.keys(typed[1].body).sort()) === '["basis","ok","requires_corrective_action","result_id","settings_used","violations"]' && JSON.stringify(Object.keys(typed[1].body.violations[0]).sort()) === '["detail","id","related_result_ids","rule_code","severity"]');
    const bad = [];
    for (const b of [{}, { control_lot_id: tLot, result_value: "abc", result_date: "2026-09-01" }, { control_lot_id: tLot, result_value: 5, result_date: "9/1/2026" }, { control_lot_id: 99999, result_value: 5, result_date: "2026-09-01" }, { control_lot_id: tLot, result_value: 5, result_date: "2026-09-01", map_instrument_id: 12345 }]) bad.push((await call("POST", `/api/labs/${T.labId}/qc/results`, b, T.token)).status);
    check("1. ... and refuses what it refused", JSON.stringify(bad) === "[400,400,400,404,400]", bad);

    // ── 2. Preview ──
    const glu = lotIn(A.labId, "Glucose", "Low", "G1", 100, 2);
    const gluHi = lotIn(A.labId, "Glucose", "High", "G2", 300, 6);
    const na = lotIn(A.labId, "Sodium", "Low", "N1", 140, 2);
    const anA = analyzerIn(A, "Made-up 500", "Analyzer A"), anB = analyzerIn(A, "Made-up 500", "Analyzer B"), anX = analyzerIn(X, "Other 900", "Elsewhere");
    lotIn(X.labId, "Glucose", "Low", "X1", 100, 2);
    const HEAD = "Date/Time,Analyzer,Test,Level,Lot,Result,Operator,Note";
    const MAP = { layout: "long", headerRow: 1, dateOrder: "mdy", dateColumn: "Date/Time", instrument: { column: "Analyzer" }, analyte: { column: "Test" }, level: { column: "Level" }, lot: { column: "Lot" }, valueColumn: "Result", operatorColumn: "Operator", commentColumn: "Note" };
    const csv = (lines: string[], name = "made-up-qc.csv", head = HEAD): Up => ({ name, bytes: [head, ...lines].join("\r\n") });
    const prev = (file: Up, mapping: any = MAP, token = editor.token, lab = A.labId) => sendFile(`${F(lab)}/preview`, file, { mapping }, token);
    const imp = (file: Up, p: any, mapping: any = MAP, token = editor.token, extra: any = {}, lab = A.labId) => sendFile(F(lab), file, { mapping, expected: { ...p.body.counts, file_sha256: p.body.file_sha256 }, ...extra }, token);
    const clock = wallClock(Date.now() + 3 * 3600_000, "America/Los_Angeles"), ago = wallClock(Date.now() - 3600_000, "America/Los_Angeles");
    // One stored run to be a duplicate of, typed the ordinary way
    const stored = (await call("POST", `/api/labs/${A.labId}/qc/results`, { control_lot_id: na, result_value: 141, result_date: "2026-06-02", run_time: "07:30", map_instrument_id: anA }, editor.token)).body.result_id;
    const mixed = csv([
      "6/1/2026 7:15,analyzer a,GLUCOSE,low,g1,100.5,Robin Tech,first run",       // 2 ready: case and spaces aside
      "6/2/2026 07:30,Analyzer A,Sodium,Low,N1,141,Robin Tech,",                   // 3 duplicate: on file
      "6/3/2026 7:15,Analyzer A,Glucose,Low,G1,101,Robin Tech,",                   // 4 ready
      "6/3/2026 7:15,Analyzer A,Glucose,Low,G1,101,Robin Tech,",                   // 5 duplicate: twice in the file
      "6/3/2026 7:16,Analyzer Z,Glucose,Low,G1,101,,",                             // 6 unknown analyzer
      "6/3/2026 7:17,Analyzer A,Potassium,Low,K1,4,,",                             // 7 unknown analyte
      "6/3/2026 7:18,Analyzer A,Glucose,Medium,G1,101,,",                          // 8 unknown level
      "6/3/2026 7:19,Analyzer A,Glucose,Low,G9,101,,",                             // 9 unknown lot
      "6/3/2026 7:20,Analyzer A,Glucose,Low,G1,<5,,",                              // 10 not a number
      "20/6/2026 7:21,Analyzer A,Glucose,Low,G1,101,,",                            // 11 a date that can't be read
      `${clock.date} ${clock.time},Analyzer A,Glucose,Low,G1,101,,`,               // 12 in the future on the lab's clock
      `${ago.date} ${ago.time},Analyzer A,Glucose,Low,G1,102,,`,                   // 13 ready: an hour ago there
      "", ",,,,,,,",                                                               // 14, 15 blank
      "6/4/2026 7:15,,Glucose,Low,G1,101,,",                                       // 16 no analyzer
    ]);
    const before = count(A.labId);
    const p1 = await prev(mixed);
    const at = (row: number) => p1.body.rows?.find((r: any) => r.row === row) ?? {};
    check("2. the preview counts every row once: 3 ready, 2 duplicate, 8 that can't be placed", p1.status === 200 && JSON.stringify(p1.body.counts) === '{"ready":3,"duplicate":2,"unplaced":8}', { s: p1.status, c: p1.body.counts, e: p1.body.error });
    check("2. case and spaces aside, a name that matches is placed as the lab writes it", at(2).outcome === "ready" && at(2).instrument === "Analyzer A" && at(2).analyte === "Glucose" && at(2).level === "Low" && at(2).lot === "G1" && at(2).date === "2026-06-01" && at(2).time === "07:15" && at(2).value === 100.5 && at(2).operator === "Robin Tech", at(2));
    check("2. a run already on file is a duplicate and says which", at(3).outcome === "duplicate" && at(3).reason === `Already on file as run #${stored}.`, at(3));
    check("2. the same row twice in the file: the second is the duplicate and says of what", at(4).outcome === "ready" && at(5).outcome === "duplicate" && /same as row 4/.test(at(5).reason), at(5));
    const reasons: Array<[number, RegExp]> = [[6, /Analyzer "Analyzer Z" isn't one this lab has/], [7, /Test "Potassium" has no control lot/], [8, /Level "Medium" isn't a level of Glucose/], [9, /Control lot "G9" isn't a lot of Glucose Low/], [10, /"<5" isn't a number/], [11, /can't be read as month, day, year/], [12, /in the future/], [16, /no analyzer/]];
    for (const [row, re] of reasons) check(`2. row ${row} can't be placed, with the reason: ${re.source.slice(0, 40)}`, at(row).outcome === "unplaced" && re.test(at(row).reason), at(row));
    check("2. an hour ago on the lab's own clock isn't the future", at(13).outcome === "ready", at(13));
    check("2. blank rows aren't rows, and row numbers are the file's", !p1.body.rows.some((r: any) => r.row === 14 || r.row === 15) && at(16).row === 16);
    check("2. the preview stores nothing", count(A.labId) === before && Number((sqlite.prepare("SELECT COUNT(*) AS n FROM qc_file_imports").get() as any).n) === 0);
    const insp = await sendFile(`${L}/inspect`, { name: "with-title.csv", bytes: ["Made-up middleware export", "", HEAD, "6/1/2026 7:15,Analyzer A,Glucose,Low,G1,100,,"].join("\n") }, {}, editor.token);
    check("2. the columns are read from the first row with headings, with a few rows to look at", insp.status === 200 && insp.body.header_row === 3 && insp.body.headers[0] === "Date/Time" && insp.body.sample[0].row === 4 && insp.body.data_rows === 1, insp.body);

    for (const h of ["Patient Name", "Name", "MRN", "DOB", "SSN", "Accession"]) {
      const r = await prev({ name: "p.csv", bytes: `${HEAD},${h}\n6/1/2026 7:15,Analyzer A,Glucose,Low,G1,100,,,zz` });
      check(`2. a file with a column "${h}" is refused by naming it`, r.status === 400 && r.body.code === "PHI_COLUMN" && r.body.column === h && r.body.error.includes(`"${h}"`), r.body);
    }
    const cell = await prev(csv([`6/1/2026 7:15,Analyzer A,Glucose,Low,G1,100,,${["123", "45", "6789"].join("-")}`]));
    check("2. a cell that looks like patient information is refused by line and column, never shown", cell.status === 400 && cell.body.code === "PHI_REFUSED" && cell.body.field === "line 2, Note" && !JSON.stringify(cell.body).includes("6789"), cell.body);
    const fname = await prev({ name: `${["MRN", "0012345"].join(" ")}.csv`, bytes: `${HEAD}\n6/1/2026 7:15,Analyzer A,Glucose,Low,G1,100,,` });
    check("2. a file name that looks like patient information is refused", fname.status === 400 && fname.body.code === "PHI_REFUSED", fname.body);
    const noCol = await prev(csv(["6/1/2026 7:15,Analyzer A"], "x.csv", "Date/Time,Analyzer"));
    check("2. a file without a mapped column says which", noCol.status === 400 && noCol.body.code === "COLUMNS_MISSING" && noCol.body.columns.includes("Result"), noCol.body);
    check("2. a mapping that isn't finished says what is missing", /control lot/.test((await prev(mixed, { ...MAP, lot: null })).body.error));

    // ── 3. Names ──
    const nameOf = (p: any, kind: string) => p.body.names.find((n: any) => n.kind === kind);
    check("3. each name to choose is listed with this lab's own choices", nameOf(p1, "instrument").text === "Analyzer Z" && nameOf(p1, "instrument").contexts[0].options.some((o: any) => o.map_instrument_id === anB) && !JSON.stringify(p1.body.names).includes("Elsewhere")
      && JSON.stringify(nameOf(p1, "level").contexts[0].options.map((o: any) => o.value).sort()) === '["High","Low"]' && JSON.stringify(nameOf(p1, "lot").contexts[0].options.map((o: any) => o.value)) === '["G1"]' && JSON.stringify(nameOf(p1, "analyte").contexts[0].options.map((o: any) => o.value)) === '["Glucose","Sodium"]', p1.body.names);
    const put = (choices: any[], token = editor.token, lab = A.labId) => call("PUT", `${F(lab)}/names`, { choices }, token);
    check("3. another lab's analyzer id is refused", (await put([{ kind: "instrument", text: "Analyzer Z", context_key: "", target: "Elsewhere", map_instrument_id: anX }])).status === 400);
    check("3. a test, level or lot this lab doesn't have is refused", (await put([{ kind: "analyte", text: "Potassium", context_key: `i:${anA}`, target: "Chloride" }])).status === 400
      && (await put([{ kind: "level", text: "Medium", context_key: "glucose", target: "Mid" }])).status === 400 && (await put([{ kind: "lot", text: "G9", context_key: "glucose|low", target: "G2" }])).status === 400);
    check("3. text that looks like patient information isn't remembered", (await put([{ kind: "instrument", text: "Analyzer Z", context_key: "", target: ["MRN", "0012345"].join(" ") }])).body.code === "PHI_REFUSED");
    check("3. nothing refused was kept", Number((sqlite.prepare("SELECT COUNT(*) AS n FROM qc_import_names").get() as any).n) === 0);
    const ctx = (kind: string) => nameOf(p1, kind).contexts[0].context_key;
    const saved = await put([
      { kind: "instrument", text: "Analyzer Z", context_key: "", target: "Analyzer B", map_instrument_id: anB }, { kind: "analyte", text: "Potassium", context_key: ctx("analyte"), target: "Sodium" },
      { kind: "level", text: "Medium", context_key: ctx("level"), target: "Low" }, { kind: "lot", text: "G9", context_key: ctx("lot"), target: "G1" },
    ]);
    check("3. a person's choices are remembered for the lab, with who made them, and audited", saved.status === 200 && saved.body.saved === 4 && saved.body.names.every((n: any) => n.chosen_by_name === "Edie Editor")
      && !!sqlite.prepare("SELECT 1 FROM audit_log WHERE module = 'veritaqc' AND entity_type = 'qc_import_names' AND user_id = ?").get(editor.userId), saved.body);
    const p2 = await prev(mixed);
    const at2 = (row: number) => p2.body.rows.find((r: any) => r.row === row);
    check("3. the next preview uses them: the analyzer, the level and the lot are placed", at2(6).outcome === "ready" && at2(6).instrument === "Analyzer B" && at2(8).outcome === "ready" && at2(8).level === "Low" && at2(9).outcome === "ready" && at2(9).lot === "G1", [at2(6), at2(8), at2(9)]);
    check("3. a choice for one place isn't used for another: Potassium means Sodium on Analyzer A only, and its lot is still asked for", /Control lot "K1" isn't a lot of Sodium Low/.test(at2(7).reason), at2(7));
    const other = await prev(csv(["6/5/2026 7:15,Analyzer B,Potassium,Low,N1,141,,"]));
    check("3. ... on Analyzer B it is asked again", other.body.counts.unplaced === 1 && nameOf(other, "analyte").contexts[0].label === "Analyzer B", other.body);
    const noName = (await call("GET", `${L}/setup`, undefined, editor.token)).body.names.find((n: any) => n.kind === "analyte").id;
    check("3. a remembered name can be forgotten", (await call("DELETE", `${L}/names/${noName}`, undefined, editor.token)).status === 200 && (await prev(mixed)).body.rows.find((r: any) => r.row === 7).reason.includes("has no control lot"));
    const twoSame = analyzerIn(A, "Twin 10", null); analyzerIn(A, "Twin 10", null);
    check("3. a name two analyzers share isn't picked between", /more than one analyzer/.test((await prev(csv(["6/5/2026 7:15,Twin 10,Glucose,Low,G1,100,,"]))).body.rows[0].reason) && twoSame > 0);

    // Saved mapping
    const sm = await call("PUT", `${L}/mappings`, { name: "Made-up middleware", mapping: MAP }, editor.token);
    const sm2 = await call("PUT", `${L}/mappings`, { name: "made-up MIDDLEWARE", mapping: { ...MAP, commentColumn: null } }, editor.token);
    check("3. a mapping is saved under a name for the lab, and the same name updates it", sm.status === 200 && sm2.body.id === sm.body.id && sm2.body.mappings.length === 1 && sm2.body.mappings[0].mapping.commentColumn === null, sm2.body);
    check("3. an unfinished mapping isn't saved", (await call("PUT", `${L}/mappings`, { name: "x", mapping: { ...MAP, valueColumn: null } }, editor.token)).status === 400);

    // ── 4. Import ──
    const p3 = await prev(mixed);
    check("4. without the preview's counts the import is refused", (await sendFile(L, mixed, { mapping: MAP }, editor.token)).body.code === "PREVIEW_FIRST");
    const wrong = await sendFile(L, mixed, { mapping: MAP, expected: { ...p3.body.counts, ready: p3.body.counts.ready + 1, file_sha256: p3.body.file_sha256 } }, editor.token);
    check("4. counts that changed since the preview: 409, nothing stored", wrong.status === 409 && wrong.body.code === "COUNT_CHANGED" && JSON.stringify(wrong.body.counts) === JSON.stringify(p3.body.counts) && count(A.labId) === before, wrong.body);
    check("4. a file that isn't the one previewed: 409", (await imp(csv(["6/1/2026 7:15,Analyzer A,Glucose,Low,G1,100.5,,"]), p3)).body.code === "FILE_CHANGED");
    const i1 = await imp(mixed, p3, MAP, editor.token, { mapping_name: "Made-up middleware" });
    check("4. the import stores the ready rows and no others", i1.status === 200 && i1.body.counts.ready === p3.body.counts.ready && count(A.labId) === before + p3.body.counts.ready, i1.body);
    const r2 = sqlite.prepare("SELECT * FROM qc_results WHERE import_id = ? AND import_row = 2").get(i1.body.import_id) as any;
    check("4. an imported run says the import, the row and the operator the file names, and isn't put down to whoever imported it", r2?.import_operator === "Robin Tech" && r2.operator_user_id === null && r2.comment === "first run" && r2.map_instrument_id === anA && r2.run_time === "07:15" && r2.result_date === "2026-06-01" && r2.control_lot_id === glu && r2.basis_source === "manufacturer", r2);
    const ir = sqlite.prepare("SELECT * FROM qc_file_imports WHERE id = ?").get(i1.body.import_id) as any;
    check("4. the import row keeps who, the file's name and hash and the rows left out, and no file", ir.imported_by_name === "Edie Editor" && ir.file_name === "made-up-qc.csv" && ir.file_sha256 === p3.body.file_sha256 && ir.mapping_name === "Made-up middleware" && JSON.parse(ir.duplicate_rows_json).includes(3) && JSON.parse(ir.unplaced_rows_json).includes(10)
      && !(sqlite.prepare("PRAGMA table_info(qc_file_imports)").all() as any[]).some((c) => /blob|content|bytes/i.test(`${c.name} ${c.type}`)), ir);
    check("4. the import is in the audit trail with its counts", JSON.parse((sqlite.prepare("SELECT after_json FROM audit_log WHERE entity_type = 'qc_file_import' AND entity_id = ?").get(String(i1.body.import_id)) as any).after_json).ready === p3.body.counts.ready);
    const list = (await call("GET", `/api/labs/${A.labId}/qc/results?control_lot_id=${glu}&limit=50`, undefined, editor.token)).body.results;
    const shown = list.find((r: any) => r.id === r2.id);
    check("4. the results list says so on the run, and a typed run carries no import", shown.imported.file_name === "made-up-qc.csv" && shown.imported.imported_by_name === "Edie Editor" && shown.import_row === 2
      && (await call("GET", `/api/labs/${A.labId}/qc/results?control_lot_id=${na}&limit=50`, undefined, editor.token)).body.results.find((r: any) => r.id === stored).imported === null, shown);

    // Judged exactly as typed: the recorded series, put in one file in a shuffled order, against the same runs typed in date and time order.
    const E = await mkLab("equal");
    sqlite.prepare("UPDATE labs SET is_demo = 0, time_zone = 'America/Los_Angeles' WHERE id = ?").run(E.labId);
    const eTyped = lotIn(E.labId, "Typed", "Low", "T1", 100, 2), eFile = lotIn(E.labId, "Filed", "Low", "F1", 100, 2);
    const inOrder = SERIES.map(([d, v, t], i) => ({ d, v, t: t ?? "", i })).sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0) || (x.t < y.t ? -1 : x.t > y.t ? 1 : 0) || x.i - y.i);
    for (const r of inOrder) await call("POST", `/api/labs/${E.labId}/qc/results`, { control_lot_id: eTyped, result_value: r.v, result_date: r.d, run_time: r.t || null, instrument: "Bench" }, E.token);
    const shuffled = SERIES.map(([d, v, t], i) => ({ line: `${d}${t ? ` ${t}` : ""},Bench,Filed,Low,F1,${v}`, k: (i * 7) % SERIES.length, d, t })).sort((a, b) => a.k - b.k);
    const eFileUp = csv(shuffled.map((s) => s.line), "series.csv", "When,Analyzer,Test,Level,Lot,Result");
    const eMap = { layout: "long", headerRow: 1, dateOrder: "mdy", dateColumn: "When", instrument: { column: "Analyzer" }, analyte: { column: "Test" }, level: { column: "Level" }, lot: { column: "Lot" }, valueColumn: "Result" };
    const ep = await prev(eFileUp, eMap, E.token, E.labId);
    const ei = await imp(eFileUp, ep, eMap, E.token, {}, E.labId);
    const verdicts = (lot: number) => (sqlite.prepare("SELECT id, result_date, COALESCE(run_time,'') AS t, result_value, basis_mean, basis_sd, basis_source FROM qc_results WHERE control_lot_id = ? ORDER BY result_date, t, result_value").all(lot) as any[])
      .map((r) => [r.result_date, r.t, r.result_value, r.basis_source, r.basis_mean, r.basis_sd, (sqlite.prepare("SELECT rule_code, severity, detail FROM qc_rule_violations WHERE qc_result_id = ? ORDER BY id").all(r.id) as any[]).map((v) => `${v.rule_code}|${v.severity}|${v.detail}`).join(" ")]);
    const vt = JSON.stringify(verdicts(eTyped)), vf = JSON.stringify(verdicts(eFile));
    check("4. a shuffled file is judged run for run as the same runs typed in date and time order", ei.status === 200 && vt === vf && verdicts(eTyped).length === SERIES.length, { status: ei.status, body: ei.body });
    const needs = (sqlite.prepare("SELECT COUNT(DISTINCT r.id) AS n FROM qc_results r JOIN qc_rule_violations v ON v.qc_result_id = r.id AND v.severity = 'rejection' WHERE r.control_lot_id = ?").get(eFile) as any).n;
    const missing = async () => (await call("GET", `/api/labs/${E.labId}/qc/recent?status=missing_ca&limit=500`, undefined, E.token)).body.results.filter((r: any) => r.control_lot_id === eFile).length;
    check("4. the runs that fired a rejection are counted and wait for their corrective action", needs > 0 && ei.body.need_corrective_action === needs && (await missing()) === needs, { needs, got: ei.body.need_corrective_action });

    // ── 5. The same file again, backdated rows, a signed month ──
    const p4 = await prev(mixed);
    check("5. the same file again: nothing is ready", p4.body.counts.ready === 0 && p4.body.counts.duplicate === p3.body.counts.ready + p3.body.counts.duplicate, p4.body.counts);
    const again = await imp(mixed, p4);
    check("5. ... and importing it stores nothing", again.status === 400 && again.body.code === "NOTHING_READY" && count(A.labId) === before + p3.body.counts.ready, again.body);

    const snapshot = (lot: number) => JSON.stringify([sqlite.prepare("SELECT id, result_value, result_date, basis_mean, basis_sd, basis_source, accepted_for_reporting, voided_at FROM qc_results WHERE control_lot_id = ? ORDER BY id").all(lot), sqlite.prepare("SELECT v.* FROM qc_rule_violations v JOIN qc_results r ON r.id = v.qc_result_id WHERE r.control_lot_id = ? ORDER BY v.id").all(lot)]);
    const hi: number[] = [];
    for (const [d, v] of [["2026-08-03", 306.5], ["2026-08-04", 313], ["2026-08-05", 301]] as const) hi.push((await call("POST", `/api/labs/${A.labId}/qc/results`, { control_lot_id: gluHi, result_value: v, result_date: d, run_time: "08:00", map_instrument_id: anA }, editor.token)).body.result_id);
    const was = snapshot(gluHi);
    const late = csv(["8/2/2026 8:00,Analyzer A,Glucose,High,G2,314,JT,", "8/4/2026 6:00,Analyzer A,Glucose,High,G2,312.6,JT,"], "late.csv");
    const lp = await prev(late);
    check("5. rows dated before a run on file, and earlier in a day that has one, are said so before anything is stored", lp.body.counts.ready === 2 && lp.body.notes.backdated === 2 && lp.body.rows.every((r: any) => r.notes.some((n: string) => /Dated before a run already on file/.test(n))), lp.body.notes);
    const li = await imp(late, lp);
    const rulesOf = (row: number) => (sqlite.prepare("SELECT v.rule_code FROM qc_rule_violations v JOIN qc_results r ON r.id = v.qc_result_id WHERE r.import_id = ? AND r.import_row = ? ORDER BY v.id").all(li.body.import_id, row) as any[]).map((v) => v.rule_code);
    const lateRules = [rulesOf(2), rulesOf(3)];
    const ids = new Set(hi);
    const nowState = JSON.parse(snapshot(gluHi));
    // 8/4 at 312.6 (2.1 SD) comes right after the day's 313 (2.2 SD): 2-2s, and 4-1s with 314 and 306.5. At the end of the lot it would follow 301 and fire 1-2s alone.
    check("5. a backdated run is judged itself, in its own place among the runs on file", JSON.stringify(lateRules) === '[["1-2s"],["1-2s","2-2s","4-1s"]]', lateRules);
    check("5. ... and no verdict already stored changed", JSON.stringify([nowState[0].filter((r: any) => ids.has(r.id)), nowState[1].filter((v: any) => ids.has(v.qc_result_id))]) === was);
    // The same backdated run typed instead gives the same verdict (how it behaves today)
    const tHi = lotIn(T.labId, "Glucose", "High", "G2", 300, 6);
    for (const [d, v] of [["2026-08-03", 306.5], ["2026-08-04", 313], ["2026-08-05", 301]] as const) await call("POST", `/api/labs/${T.labId}/qc/results`, { control_lot_id: tHi, result_value: v, result_date: d, run_time: "08:00" }, T.token);
    const tLate: string[][] = [];
    for (const [d, v, t] of [["2026-08-02", 314, "08:00"], ["2026-08-04", 312.6, "06:00"]] as const) tLate.push((await call("POST", `/api/labs/${T.labId}/qc/results`, { control_lot_id: tHi, result_value: v, result_date: d, run_time: t }, T.token)).body.violations.map((x: any) => x.rule_code));
    check("5. ... exactly as the same runs typed late", JSON.stringify(tLate) === JSON.stringify(lateRules), tLate);
    const sameDay = await prev(csv(["8/5/2026 6:00,Analyzer A,Glucose,High,G2,302,,"]));
    check("5. a row earlier in the day than the day's run is counted apart", sameDay.body.notes.same_day === 1 && sameDay.body.notes.backdated === 0, sameDay.body.notes);

    const rev = await call("POST", `/api/labs/${A.labId}/qc/period-reviews`, { control_lot_id: gluHi, period_year: 2026, period_month: 8, attestation_acknowledged: true, review_notes: "Reviewed" }, A.token);
    const reviewRow = () => JSON.stringify(sqlite.prepare("SELECT * FROM qc_period_reviews WHERE control_lot_id = ?").all(gluHi));
    const signedAs = reviewRow();
    await new Promise((r) => setTimeout(r, 15));
    const after = csv(["8/20/2026 8:00,Analyzer A,Glucose,High,G2,301.5,JT,", "8/21/2026 8:00,Analyzer A,Glucose,High,G2,330,JT,"], "after-review.csv");
    const ap = await prev(after);
    check("5. a row in a signed month is said so before anything is stored, with the month and who signed", rev.status === 200 && ap.body.notes.after_review.length === 1 && ap.body.notes.after_review[0].rows === 2 && ap.body.notes.after_review[0].month === "2026-08" && ap.body.notes.after_review[0].reviewed_by === "Owner a", ap.body.notes);
    const ai = await imp(after, ap);
    const recent = (await call("GET", `/api/labs/${A.labId}/qc/recent?since=2026-08-01&until=2026-08-31&limit=200`, undefined, editor.token)).body.results.filter((r: any) => r.control_lot_id === gluHi);
    check("5. the signed review is untouched, and the runs after it are marked as added after it; the ones before aren't", reviewRow() === signedAs && recent.filter((r: any) => r.added_after_review).length === 2 && recent.filter((r: any) => !r.added_after_review).length === 5, recent.map((r: any) => [r.result_date, r.added_after_review]));
    const lab = sqlite.prepare("SELECT id, lab_name, clia_number FROM labs WHERE id = ?").get(A.labId) as any;
    const html = buildMonthlyReviewHTML(buildMonthlyReviewPayload(sqlite, A.labId, sqlite.prepare("SELECT * FROM qc_control_lots WHERE id = ?").get(gluHi), lab, 2026, 8));
    check("5. the monthly review prints them marked, says how many, and names the file's operator as text", (html.match(/Added after the review/g) || []).length === 2 && html.includes("2 runs were added after this review was signed") && html.includes("JT, imported from a file"), html.match(/Added after[^<]*/g));
    const unsigned = buildMonthlyReviewHTML(buildMonthlyReviewPayload(sqlite, A.labId, sqlite.prepare("SELECT * FROM qc_control_lots WHERE id = ?").get(glu), lab, 2026, 6));
    check("5. a month with no signed review prints no mark", !unsigned.includes("dded after"));

    // ── 6. Taking an import back ──
    const mk = csv(["9/1/2026 8:00,Analyzer A,Sodium,Low,N1,140.5,JT,", "9/2/2026 8:00,Analyzer A,Sodium,Low,N1,152,JT,", "9/3/2026 8:00,Analyzer A,Sodium,Low,N1,139.5,JT,", "8/30/2026 8:00,Analyzer A,Sodium,Low,N1,141.5,JT,", "9/4/2026 8:00,Analyzer A,Sodium,Low,N1,153,JT,"], "take-back.csv");
    const mp = await prev(mk);
    const mi = await imp(mk, mp);
    const U = `${L}/${mi.body.import_id}`;
    const runAt = (row: number) => sqlite.prepare("SELECT * FROM qc_results WHERE import_id = ? AND import_row = ?").get(mi.body.import_id, row) as any;
    // Row 3 fires 1-3s: its corrective action is filed the ordinary way. Row 5 is in August, reviewed after it was stored.
    const viol = sqlite.prepare("SELECT id FROM qc_rule_violations WHERE qc_result_id = ? AND severity = 'rejection'").get(runAt(3).id) as any;
    await call("POST", `/api/labs/${A.labId}/qc/corrective-actions`, { qc_result_id: runAt(3).id, qc_rule_violation_id: viol.id, action_taken: "Reran the control" }, editor.token);
    await call("POST", `/api/labs/${A.labId}/qc/period-reviews`, { control_lot_id: na, period_year: 2026, period_month: 8, attestation_acknowledged: true }, A.token);
    await call("POST", `/api/labs/${A.labId}/qc/results/${runAt(2).id}/void`, { reason: "Wrong bottle" }, editor.token);
    const d1 = await call("GET", U, undefined, editor.token);
    check("6. before taking it back: how many would be voided, and which stay and why", d1.body.undo.will_void === 2 && JSON.stringify(d1.body.undo.stays.map((s: any) => s.import_row).sort()) === "[3,5]" && d1.body.undo.stays.some((s: any) => /corrective action/.test(s.why)) && d1.body.undo.stays.some((s: any) => /2026-08 review signed by Owner a/.test(s.why)), d1.body.undo);
    check("6. a reason is required", (await call("POST", `${U}/undo`, { reason: "  " }, editor.token)).body.code === "REASON_REQUIRED");
    check("6. what would be taken back changed: 409", (await call("POST", `${U}/undo`, { reason: "Wrong file", expected_void: 4 }, editor.token)).body.code === "COUNT_CHANGED");
    const readyNa = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM qc_rule_violations v JOIN qc_results r ON r.id = v.qc_result_id WHERE r.import_id = ?").get(mi.body.import_id) as any).n);
    const violsBefore = readyNa();
    const qcMissing = () => (computeLabReadiness(sqlite, A.labId) as any).modules.find((m: any) => m.key === "qc").overdue;
    const missBefore = qcMissing();
    const undo = await call("POST", `${U}/undo`, { reason: "Wrong file", expected_void: 2 }, A.token);
    check("6. the lab's own editors take it back as a whole; the rest stay and are listed", undo.status === 200 && undo.body.voided === 2 && undo.body.stays.length === 2, undo.body);
    const gone = runAt(4), kept = runAt(3), vByHand = runAt(2);
    check("6. by the module's void: the row is kept with who, when and why", !!gone.voided_at && gone.voided_by_user_id === A.userId && gone.void_reason === `Import #${mi.body.import_id} taken back: Wrong file` && gone.void_source === "import_undo" && gone.result_value === 139.5 && !kept.voided_at && vByHand.void_reason === "Wrong bottle" && vByHand.void_source === null && readyNa() === violsBefore, { gone, vByHand });
    check("6. it is in the audit trail", !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'qc_file_import.undo' AND entity_id = ? AND user_id = ?").get(String(mi.body.import_id), A.userId));
    check("6. a second time: 409", (await call("POST", `${U}/undo`, { reason: "Again" }, editor.token)).body.code === "ALREADY_TAKEN_BACK");
    const feed = (await call("GET", `/api/labs/${A.labId}/qc/recent?since=2026-09-01&limit=200`, undefined, editor.token)).body.results.map((r: any) => r.id);
    const line = (await call("GET", `/api/labs/${A.labId}/qc/line?analyte=Sodium&level=Low`, undefined, editor.token)).body.points.map((p: any) => p.id);
    const study = await call("POST", `/api/labs/${A.labId}/qc/import-preview`, { analyte: "Sodium", control_lot_id: na, subsample_strategy: "all" }, A.token);
    check("6. taken-back runs leave the feed, the chart across lots, a VeritaCheck import and the corrective actions owed; a run voided by hand is where it was", !feed.includes(gone.id) && feed.includes(vByHand.id) && !line.includes(gone.id) && line.includes(kept.id)
      && study.status === 200 && !study.body.import_source.result_ids.includes(gone.id) && study.body.import_source.result_ids.includes(kept.id) && qcMissing() === missBefore - 1, { missBefore, after: qcMissing(), study: study.status });
    const mp2 = await prev(mk);
    const o = (row: number) => mp2.body.rows.find((r: any) => r.row === row);
    check("6. the file can be imported again: taken-back runs are ready, the ones that stayed are duplicates, and one voided by hand is a duplicate that says so", o(4).outcome === "ready" && o(6).outcome === "ready" && o(3).outcome === "duplicate" && o(5).outcome === "duplicate" && o(2).outcome === "duplicate" && /was voided \(Wrong bottle\)/.test(o(2).reason), mp2.body.rows.map((r: any) => [r.row, r.outcome, r.reason]));
    const afterRun = sqlite.prepare("SELECT id FROM qc_results WHERE import_id = ? AND import_row = 2").get(ai.body.import_id) as any;
    const d2 = await call("GET", `${L}/${ai.body.import_id}`, undefined, editor.token);
    check("6. a run added after the review was signed isn't in that review, so it can be taken back", d2.body.undo.will_void === 2 && d2.body.undo.stays.length === 0 && !!afterRun, d2.body.undo);

    // ── 7. Excel, zones, wide files, limits ──
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Cover").addRow(["Made-up export"]);
    const ws = wb.addWorksheet("QC");
    ws.addRow(["When", "Clock", "Analyzer", "Test", "Level", "Lot", "Result"]);
    const rowOf = (when: any, clockCell: any, lot: any, value: any, fmt = "m/d/yyyy h:mm") => { const r = ws.addRow([when, clockCell, "Analyzer A", "Chloride", "1", lot, value]); if (when instanceof Date) r.getCell(1).numFmt = fmt; if (clockCell instanceof Date) r.getCell(2).numFmt = "h:mm"; return r; };
    lotIn(A.labId, "Chloride", "1", "45921", 100, 2);
    rowOf(new Date(Date.UTC(2026, 6, 1, 23, 45)), null, 45921, 101.5);                                  // 2: a date and time cell, a numeric lot
    rowOf(new Date(Date.UTC(2026, 6, 2)), null, "45921", { formula: "50+52", result: 102 }, "m/d/yyyy"); // 3: a date only, a formula value
    rowOf(new Date(Date.UTC(2026, 6, 3, 7, 5, 30)), null, "45921", { formula: "1/0", result: { error: "#DIV/0!" } });  // 4: a formula error
    rowOf(45981, null, "45921", 100);                                                                    // 5: a serial nobody formatted
    rowOf("2026-07-05T02:30:00Z", null, "45921", 100.4);                                                 // 6: a zone
    rowOf({ formula: "A2", result: 46210.5 }, null, "45921", 99.2).getCell(1).numFmt = "m/d/yyyy h:mm";   // 7: a formula date
    const xbuf = Buffer.from(await wb.xlsx.writeBuffer());
    const xMap = { sheet: "QC", layout: "long", headerRow: 1, dateOrder: "mdy", dateColumn: "When", instrument: { column: "Analyzer" }, analyte: { column: "Test" }, level: { column: "Level" }, lot: { column: "Lot" }, valueColumn: "Result" };
    const xp = await prev({ name: "export.xlsx", bytes: xbuf }, xMap);
    const x = (row: number) => xp.body.rows.find((r: any) => r.row === row) ?? {};
    check("7. Excel: a date cell is the wall clock it shows, and a number lot reads as its digits", x(2).date === "2026-07-01" && x(2).time === "23:45" && x(2).outcome === "ready", { x: x(2), e: xp.body.error });
    check("7. Excel: a date with no time has none, and a formula reads as its value", x(3).date === "2026-07-02" && x(3).time === null && x(3).value === 102, x(3));
    check("7. Excel: a formula error and an unformatted serial are refused with why", /#DIV\/0!/.test(x(4).reason) && x(4).time === "07:05:30" && /Format the column as a date/.test(x(5).reason), [x(4), x(5)]);
    check("7. a time with a zone becomes the lab's own clock", x(6).date === "2026-07-04" && x(6).time === "19:30", x(6));
    check("7. Excel: a date worked out by a formula reads as its value", x(7).date === "2026-07-07" && x(7).time === "12:00", x(7));
    const xi = await sendFile(`${L}/inspect`, { name: "export.xlsx", bytes: xbuf }, { sheet: "QC" }, editor.token);
    check("7. Excel: the sheets are listed and the one asked for is read", JSON.stringify(xi.body.sheets) === '["Cover","QC"]' && xi.body.sheet === "QC" && xi.body.headers[0] === "When", xi.body);
    check("7. a sheet that isn't there is refused", (await prev({ name: "export.xlsx", bytes: xbuf }, { ...xMap, sheet: "Nope" })).body.code === "BAD_FILE");
    const wideA = await prev(csv(["7/10/2026 7:00,Low,G1,100,", "7/11/2026 7:00,Low,G1,101,140.2"], "wide-a.csv", "When,Level,Lot,Glucose,Sodium"), { layout: "wide", headerRow: 1, dateOrder: "mdy", dateColumn: "When", instrument: { fixed: "Analyzer A" }, level: { column: "Level" }, lot: { column: "Lot" }, valueColumns: [{ column: "Glucose", analyte: "Glucose" }, { column: "Sodium", analyte: "Sodium", lot: "N1" }] });
    check("7. one column per test: a run per value, blank cells are no run", JSON.stringify(wideA.body.counts) === '{"ready":3,"duplicate":0,"unplaced":0}' && wideA.body.rows[1].row === 3 && wideA.body.rows[2].analyte === "Sodium" && wideA.body.rows[2].lot === "N1" && wideA.body.rows[2].column === "Sodium", wideA.body);
    const wFile = csv(["7/10/2026 7:00,Analyzer A,Glucose,100.1,301"], "wide-l.csv", "When,Inst,Test,L1,L2");
    const wMap = { layout: "wide", headerRow: 1, dateOrder: "mdy", dateColumn: "When", instrument: { column: "Inst" }, analyte: { column: "Test" }, valueColumns: [{ column: "L1", level: "Low", lot: "G1" }, { column: "L2", level: "High", lot: "G2" }] };
    const wp = await prev(wFile, wMap);
    const wi = await imp(wFile, wp, wMap);
    const wr = sqlite.prepare("SELECT import_row, import_column, control_lot_id, result_value FROM qc_results WHERE import_id = ? ORDER BY id").all(wi.body.import_id ?? -1) as any[];
    check("7. one column per level: stored with the row and the column each came from", wr.length === 2 && wr.some((r) => r.import_row === 2 && r.import_column === "L1" && r.control_lot_id === glu) && wr.some((r) => r.import_column === "L2" && r.control_lot_id === gluHi && r.result_value === 301), wr);
    const many = (n: number) => csv(Array.from({ length: n }, (_v, i) => `${new Date(Date.UTC(2025, 0, 1) + i * 600_000).toISOString().slice(0, 16).replace("T", " ")},Bench,Bulk,Low,B1,${(100 + ((i * 37) % 17) / 10).toFixed(1)}`), "many.csv", "When,Analyzer,Test,Level,Lot,Result");
    check("7. 10,001 results are refused", (await prev(many(10_001), eMap, E.token, E.labId)).body.code === "TOO_MANY_ROWS");
    lotIn(E.labId, "Bulk", "Low", "B1", 100, 2);
    const mf = many(10_000);
    const t0 = Date.now();
    const bp = await prev(mf, eMap, E.token, E.labId), t1 = Date.now();
    const bi = await imp(mf, bp, eMap, E.token, {}, E.labId), t2 = Date.now();
    console.log(`      10,000 runs on one lot: preview ${t1 - t0} ms, import ${t2 - t1} ms`);
    check("7. 10,000 go in, in one go", bi.status === 200 && bi.body.counts.ready === 10_000, { s: bi.status, b: bi.body });
    check("7. a file over 10 MB is refused", (await prev({ name: "big.csv", bytes: Buffer.alloc(10 * 1024 * 1024 + 10, "a") })).body.code === "FILE_TOO_LARGE");
    check("7. an old or password-protected workbook, a file that isn't text, and an empty one are refused in words", (await prev({ name: "a.xls", bytes: Buffer.from("d0cf11e0a1b11ae10000", "hex") })).body.code === "BAD_FILE" && (await prev({ name: "a.csv", bytes: Buffer.from([1, 0, 2, 0, 3]) })).body.code === "BAD_FILE" && (await prev({ name: "a.csv", bytes: "" })).body.code === "BAD_FILE" && (await prev({ name: "a.xlsx", bytes: Buffer.from("504b0304aaaa", "hex") })).status === 400);
    check("7. no file: says so", (await sendFile(`${L}/preview`, null, { mapping: MAP }, editor.token)).body.code === "NO_FILE");
    const utf16 = await prev({ name: "u16.csv", bytes: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${HEAD.replace(/,/g, "\t")}\n6/9/2026 7:15\tAnalyzer A\tGlucose\tLow\tG1\t100\t\t`, "utf16le")]) });
    check("7. a tab-separated UTF-16 export reads", utf16.body.counts?.ready === 1, utf16.body);

    // ── 7b. A lot that is retired or on hold ──
    const lotCall = (id: number, body: any) => call("PATCH", `/api/labs/${A.labId}/qc/control-lots/${id}`, body, A.token);
    const rLot = lotIn(A.labId, "Retired test", "Low", "R1", 100, 2), hLot = lotIn(A.labId, "Held test", "Low", "H1", 100, 2);
    sqlite.prepare("UPDATE qc_control_lots SET opened_date = '2026-01-01' WHERE id IN (?, ?)").run(rLot, hLot);
    const laToday = wallClock(Date.now(), "America/Los_Angeles").date;
    check("7. retiring keeps its day and putting on hold records the lab's own", (await lotCall(rLot, { status: "retired", out_of_use_date: "2026-07-10" })).status === 200 && (await lotCall(hLot, { status: "hold" })).status === 200
      && (sqlite.prepare("SELECT held_date FROM qc_control_lots WHERE id = ?").get(hLot) as any).held_date === laToday);
    sqlite.prepare("UPDATE qc_control_lots SET held_date = '2026-07-12' WHERE id = ?").run(hLot);
    await lotCall(hLot, { status: "hold" });
    check("7. ... and asking for the hold again keeps the day it began", (sqlite.prepare("SELECT held_date FROM qc_control_lots WHERE id = ?").get(hLot) as any).held_date === "2026-07-12");
    const closedFile = csv(["7/10/2026 8:00,Analyzer A,Retired test,Low,R1,100,,", "7/11/2026 8:00,Analyzer A,Retired test,Low,R1,100,,", "7/12/2026 8:00,Analyzer A,Held test,Low,H1,100,,", "7/13/2026 8:00,Analyzer A,Held test,Low,H1,100,,"]);
    const cp = await prev(closedFile);
    check("7. a row on or before the day can be imported, one after it can't be placed, with the day",
      JSON.stringify(cp.body.counts) === '{"ready":2,"duplicate":0,"unplaced":2}' && cp.body.rows[1].reason === "This lot was retired on 2026-07-10." && cp.body.rows[3].reason === "This lot was put on hold on 2026-07-12." && cp.body.notes.inactive_lot === 2, cp.body.rows);
    const typedAt = async (lot: number, day: string, v = 101) => call("POST", `/api/labs/${A.labId}/qc/results`, { control_lot_id: lot, result_value: v, result_date: day, instrument: "Analyzer A" }, editor.token);
    const storedOn = (lot: number) => JSON.stringify(sqlite.prepare("SELECT * FROM qc_results WHERE control_lot_id = ? ORDER BY id").all(lot));
    const s0r = storedOn(rLot);
    const tNo = [await typedAt(rLot, "2026-07-11"), await typedAt(hLot, "2026-07-13")];
    check("7. the same day, the same answer, for a run typed at the server: 409 with the same words, nothing stored", tNo.every((r) => r.status === 409 && r.body.code === "LOT_NOT_IN_USE") && tNo[0].body.error === cp.body.rows[1].reason && tNo[1].body.error === cp.body.rows[3].reason && storedOn(rLot) === s0r, tNo.map((r) => r.body));
    check("7. ... and one on the day is taken", (await typedAt(rLot, "2026-07-10")).status === 200 && (await typedAt(hLot, "2026-07-12")).status === 200);
    sqlite.prepare("UPDATE qc_control_lots SET out_of_use_date = NULL WHERE id = ?").run(rLot);
    const unk = await prev(closedFile);
    check("7. with no day on file nobody can tell, so it can't be placed, and says how to put the day on file", /the day isn't on file\. Re-activate it, then retire it with its date/.test(unk.body.rows[0].reason) && (await typedAt(rLot, "2026-07-01")).status === 409, unk.body.rows[0]);
    await lotCall(rLot, { status: "active" }); await lotCall(hLot, { status: "active" });
    check("7. an active lot takes any day, and the hold's day is gone with the hold", (await typedAt(rLot, "2026-07-20")).status === 200 && (sqlite.prepare("SELECT held_date FROM qc_control_lots WHERE id = ?").get(hLot) as any).held_date === null);

    // ── 8. Who may ──
    const one = csv(["6/20/2026 7:15,Analyzer A,Glucose,Low,G1,100.7,,"]);
    const op = await prev(one);
    const cnt = count(A.labId);
    for (const [who, token] of [["a Staff login", staff.token], ["a view-only seat", viewer.token]] as const) {
      const st = [
        (await call("GET", `${L}/setup`, undefined, token)).status,
        (await sendFile(`${L}/inspect`, one, {}, token)).status, (await prev(one, MAP, token)).status, (await imp(one, op, MAP, token)).status,
        (await call("PUT", `${L}/mappings`, { name: "x", mapping: MAP }, token)).status, (await put([{ kind: "instrument", text: "Q", context_key: "", target: "Analyzer B", map_instrument_id: anB }], token)).status,
        (await call("POST", `${L}/${i1.body.import_id}/undo`, { reason: "no" }, token)).status,
        (await call("PUT", `/api/labs/${A.labId}/qc/sigma/peer-mean`, { control_lot_id: glu, peer_mean: 5 }, token)).status, (await call("PUT", `/api/labs/${A.labId}/qc/sigma/allowable-error`, { analyte: "Glucose", percent: 8 }, token)).status, (await call("DELETE", `${L}/mappings/${sm.body.id}`, undefined, token)).status,
      ];
      check(`8. ${who} is refused mapping, names, preview, import, undo and every setting`, st.every((s) => s === 403), st);
      const reads = [await call("GET", L, undefined, token), await call("GET", `${L}/${i1.body.import_id}`, undefined, token), await call("GET", `/api/labs/${A.labId}/qc/sigma`, undefined, token)];
      if (who === "a Staff login") check("8. a Staff login reads neither the imports nor the sigma metric, as before", reads.every((r) => r.status === 403 && r.body.code === "STAFF_OWN_ONLY"), reads.map((r) => r.status));
      else check("8. a view-only seat reads both, as VeritaQC's own reads, and is told it can't change them", reads.every((r) => r.status === 200) && reads[0].body.imports.length > 0 && reads[1].body.can_import === false && reads[2].body.can_set === false, reads.map((r) => r.status));
      check(`8. ${who} still records a run and reads the results as before`, (await call("POST", `/api/labs/${A.labId}/qc/results`, { control_lot_id: glu, result_value: 100, result_date: "2026-06-21", run_time: who === "a Staff login" ? "07:00" : "08:00" }, token)).status === 200 && (await call("GET", `/api/labs/${A.labId}/qc/results?control_lot_id=${glu}`, undefined, token)).status === 200);
    }
    const xs = [(await call("GET", `${L}/setup`, undefined, X.token)).status, (await prev(one, MAP, X.token)).status, (await imp(one, op, MAP, X.token)).status, (await call("POST", `${L}/${i1.body.import_id}/undo`, { reason: "no" }, X.token)).status, (await call("GET", `/api/labs/${A.labId}/qc/sigma`, undefined, X.token)).status];
    check("8. another customer is refused at this lab's address", xs.every((s) => s === 403), xs);
    const xown = [(await call("GET", `${F(X.labId)}/${i1.body.import_id}`, undefined, X.token)).status, (await call("POST", `${F(X.labId)}/${i1.body.import_id}/undo`, { reason: "no" }, X.token)).status, (await call("DELETE", `${F(X.labId)}/mappings/${sm.body.id}`, undefined, X.token)).status, (await call("DELETE", `${F(X.labId)}/names/${saved.body.names[0].id}`, undefined, X.token)).status, (await call("PUT", `/api/labs/${X.labId}/qc/sigma/peer-mean`, { control_lot_id: glu, peer_mean: 5 }, X.token)).status];
    check("8. ... and gets this lab's imports, mappings, names and lots from its own address as not found", xown.every((s) => s === 404), xown);
    const xprev = await prev(one, MAP, X.token, X.labId);
    check("8. ... and its own preview knows none of this lab's names", xprev.body.counts.unplaced === 1 && !JSON.stringify(xprev.body.names).includes("Analyzer B"), xprev.body.names);
    check("8. nobody signed in: 401", (await call("GET", `${L}/setup`)).status === 401);
    const support = await mkLab("support");
    sqlite.prepare("UPDATE users SET vls_support = 1 WHERE id = ?").run(support.userId);
    sqlite.prepare("UPDATE labs SET vls_support_access = 1 WHERE id = ?").run(A.labId);
    const sset = [(await call("GET", `${L}/setup`, undefined, support.token)).status, (await prev(one, MAP, support.token)).status, (await call("PUT", `${L}/mappings`, { name: "Set up by support", mapping: MAP }, support.token)).status, (await put([{ kind: "instrument", text: "Set by support", context_key: "", target: "Analyzer B", map_instrument_id: anB }], support.token)).status];
    check("8. Veritas support sets up a mapping and names, and its audit row says who it was", sset.every((s) => s === 200) && !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'qc_import_mapping' AND user_id = ? AND acting_as = 'vls_support'").get(support.userId), sset);
    const sread = [await call("GET", L, undefined, support.token), await call("GET", `${L}/${i1.body.import_id}`, undefined, support.token), await call("GET", `/api/labs/${A.labId}/qc/sigma`, undefined, support.token)];
    check("8. ... reads the imports and the sigma metric, marked as not able to change them", sread.every((r) => r.status === 200) && sread[1].body.can_import === false && sread[2].body.can_set === false);
    const sno = [await imp(one, op, MAP, support.token), await call("POST", `${L}/${i1.body.import_id}/undo`, { reason: "no" }, support.token), await call("PUT", `/api/labs/${A.labId}/qc/sigma/allowable-error`, { analyte: "Glucose", percent: 8 }, support.token), await call("PUT", `/api/labs/${A.labId}/qc/sigma/peer-mean`, { control_lot_id: glu, peer_mean: 5 }, support.token)];
    check("8. ... and can't import, take back, or set an allowable error or a peer mean", sno.every((r) => r.status === 403 && r.body.code === "VLS_SUPPORT_CANNOT_SIGN"), sno.map((r) => [r.status, r.body.code]));
    check("8. nothing refused stored a run", count(A.labId) === cnt + 2);

    // ── 9. The sigma metric ──
    const S = `/api/labs/${A.labId}/qc/sigma`;
    const sig = async () => (await call("GET", S, undefined, editor.token)).body;
    const sLot = lotIn(A.labId, "Albumin", "Low", "AL1", 100, 2);
    for (const [i, v] of [100, 102, 104].entries()) await call("POST", `/api/labs/${A.labId}/qc/results`, { control_lot_id: sLot, result_value: v, result_date: `2026-05-0${i + 1}`, instrument: "Analyzer A" }, editor.token);
    const row = (b: any) => b.rows.find((r: any) => r.control_lot_id === sLot);
    const s0 = row(await sig());
    check("9. with no allowable error: not enough to compute, and what is missing", s0.result.sigma === null && s0.result.missing.join() === "an allowable error for this test" && s0.result.n === 3, s0.result);
    const crit = (await sig()).analytes.find((a: any) => a.analyte === "Albumin").criteria;
    check("9. the criteria offered are the app's own for that test", crit.length === 1 && crit[0].label.startsWith("Albumin"), crit);
    check("9. a criterion for another test, and more than one kind at once, are refused", (await call("PUT", `${S}/allowable-error`, { analyte: "Albumin", preset_label: (await sig()).analytes.find((a: any) => a.analyte === "Glucose").criteria[0].label }, editor.token)).body.code === "NOT_THIS_TEST"
      && (await call("PUT", `${S}/allowable-error`, { analyte: "Albumin", percent: 8, units_value: 2 }, editor.token)).status === 400 && (await call("PUT", `${S}/allowable-error`, { analyte: "Albumin", percent: -1 }, editor.token)).status === 400 && (await call("PUT", `${S}/allowable-error`, { analyte: "Nope", percent: 8 }, editor.token)).status === 404);
    await call("PUT", `${S}/allowable-error`, { analyte: "Albumin", percent: 10 }, editor.token);
    const s1 = row(await sig()).result;
    check("9. (10 - 2) / 1.9608 = 4.08, from 3 runs against the manufacturer's mean", Math.abs(s1.sigma - 4.08) < 1e-9 && s1.from_few_runs && s1.n === 3 && s1.target.source === "manufacturer" && s1.target.value === 100, s1);
    await call("PUT", `${S}/allowable-error`, { analyte: "Albumin", preset_label: crit[0].label }, editor.token);
    const s2 = row(await sig()).result;
    check("9. the picked criterion: (8 - 2) / 1.9608 = 3.06", Math.abs(s2.sigma - 3.06) < 1e-9 && /493\.931/.test(s2.allowable_how), s2);
    await call("PUT", `${S}/peer-mean`, { control_lot_id: sLot, peer_mean: 102, note: "Made-up peer report" }, editor.token);
    const s3 = row(await sig()).result;
    check("9. a peer mean the lab enters is the target", s3.target.source === "peer" && s3.bias_percent === 0 && Math.abs(s3.sigma - 8 / (200 / 102)) < 1e-9, s3);
    const own = lotIn(A.labId, "Own mean", "Low", "OM1", 100.43, 2);
    for (const [i, v] of [100.1, 102.3, 98.9].entries()) await call("POST", `/api/labs/${A.labId}/qc/results`, { control_lot_id: own, result_value: v, result_date: `2026-05-0${i + 1}`, instrument: "Analyzer A" }, editor.token);
    const ownRow = (await sig()).rows.find((r: any) => r.control_lot_id === own);
    check("9. the target is named, and a manufacturer mean that is the lab's own mean says so; one that isn't doesn't", ownRow.target_is_own_mean === true && ownRow.result.target.source === "manufacturer" && row(await sig()).target_is_own_mean === false && (await sig()).rows.find((r: any) => r.control_lot_id === glu).target_is_own_mean === false, ownRow);
    const last = (sqlite.prepare("SELECT id FROM qc_results WHERE control_lot_id = ? ORDER BY id DESC").get(sLot) as any).id;
    await call("POST", `/api/labs/${A.labId}/qc/results/${last}/void`, { reason: "Mis-keyed" }, editor.token);
    check("9. a voided run isn't used, and the count says so", row(await sig()).result.n === 2);
    check("9. each change is in the audit trail with before and after", (sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'qc_allowable_error' AND entity_id = 'Albumin' AND user_id = ?").get(editor.userId) as any).n === 2 && !!sqlite.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'qc_peer_mean' AND before_json IS NULL").get());
    await call("PUT", `${S}/allowable-error`, { analyte: "Albumin", clear: true }, editor.token);
    check("9. cleared: not enough to compute again", row(await sig()).result.sigma === null);

    // ── 10. Export-all and purge ──
    const tables = ["qc_file_imports", "qc_import_mappings", "qc_import_names", "qc_allowable_errors", "qc_peer_means"];
    await call("PUT", `${S}/allowable-error`, { analyte: "Albumin", percent: 10 }, editor.token);
    check("10. every table is classified for export-all and has a purge rule", unclassifiedTables(sqlite).length === 0 && unruledTables(sqlite).length === 0 && tables.every((t) => !!EXPORT_TABLES[t] && purgeRule(t)?.kind === "delete"), [unclassifiedTables(sqlite), unruledTables(sqlite)]);
    const rowsFor = (t: string, lab: number) => selectRecords(sqlite, t, exportContext(sqlite, lab)!)!.rows as any[];
    check("10. Download all records carries each of them for this lab and no other lab's", tables.every((t) => { const r = rowsFor(t, A.labId); return r.length > 0 && r.every((x) => x.lab_id === A.labId); }) && tables.every((t) => rowsFor(t, X.labId).length === 0), tables.map((t) => [t, rowsFor(t, A.labId).length]));
    const plan = planCustomerPurge(sqlite, { ownerUserId: A.userId }) as any;
    check("10. deleting the customer takes each of them", !!plan.plan && tables.every((t) => plan.plan.rowsByTable[t] === rowsFor(t, A.labId).length), plan.code ?? plan.plan?.rowsByTable);
    if (plan.plan) applyCustomerPurge(sqlite, plan.plan, plan.internal);
    check("10. ... and leaves none", tables.every((t) => Number((sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE lab_id = ?`).get(A.labId) as any).n) === 0) && count(E.labId) > 0);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
