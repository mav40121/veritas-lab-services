// scripts/dryrun-competency-carryover.mts
//
// READ-ONLY dry run (Michael Q160 = 1, 2026-10-13): how a lab's program-based VeritaComp records would carry over to
// per-method sign-off (PR #1623). Reads a database file (a production backup copy), writes NOTHING to it, and writes
// one review workbook. Every program record is mapped to person + method (instrument) + competency + date + signer,
// using the same rules the app uses:
//   - person: the record's VeritaStaff link, else an exact name match to ONE active VeritaStaff person
//   - methods: the instruments the program's method groups name (shared/competencyStatus methodGroupCoversInstrument)
//     that are on the lab's VeritaMap AND assigned to that person in VeritaStaff
//   - signer: the record's evaluator matched by name to an active VeritaStaff person, checked against the per-method
//     signer rules (shared/competencySignoff methodSignerOptions) for that method's complexity and department, and
//     never the person assessed
// Anything that does not map cleanly goes to "Needs a decision" with the reason and a suggestion; nothing is guessed.
// Run: npx tsx --tsconfig tsconfig.json scripts/dryrun-competency-carryover.mts --db <backup.db> --lab 36 --out <file.xlsx>
import { createRequire } from "node:module";
import { methodSignerOptions, alignAnnualToMonth, MILESTONE_LABEL, type SignerCandidate, type MethodMilestone } from "../shared/competencySignoff";
import { methodGroupCoversInstrument } from "../shared/competencyStatus";
const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const DB = arg("db"), LAB = Number(arg("lab")), OUT = arg("out"), MONTH = arg("annual-month") ? Number(arg("annual-month")) : null;
if (!DB || !Number.isFinite(LAB) || !OUT) { console.error("usage: --db <file> --lab <id> --out <xlsx> [--annual-month 1-12]"); process.exit(1); }
const db = new Database(DB, { readonly: true, fileMustExist: true });
const q = (sql: string, ...a: any[]) => db.prepare(sql).all(...a) as any[];
const norm = (s: any) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
const addMonths = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };

const lab = q("SELECT id, lab_name, medical_director_name FROM labs WHERE id = ?", LAB)[0];
if (!lab) { console.error(`lab ${LAB} not found`); process.exit(1); }
const staff = q("SELECT id, first_name, last_name, status FROM staff_employees WHERE tier2_lab_id = ?", LAB);
const active = staff.filter((s) => s.status === "active");
const byName = new Map<string, any[]>();
for (const s of active) { const k = norm(`${s.first_name} ${s.last_name}`); byName.set(k, [...(byName.get(k) || []), s]); }
const nameOf = (s: any) => `${s.first_name || ""} ${s.last_name || ""}`.trim();

// Instruments on the lab's maps, with complexity from their active tests (highest wins, same as the app).
const insts = q(`SELECT i.id, i.instrument_name, i.category FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id WHERE m.lab_id = ?`, LAB);
const rank = (c: string) => { const u = String(c || "").toUpperCase(); return u.startsWith("H") ? 3 : u.startsWith("M") ? 2 : u.startsWith("W") ? 1 : 0; };
const cxOf = new Map<number, string>();
for (const i of insts) {
  const r = q("SELECT DISTINCT complexity FROM veritamap_instrument_tests WHERE instrument_id = ? AND active = 1", i.id).reduce((m: number, t: any) => Math.max(m, rank(t.complexity)), 0);
  cxOf.set(i.id, r >= 3 ? "HIGH" : r === 2 ? "MODERATE" : r === 1 ? "WAIVED" : "UNSPECIFIED");
}
const assigned = new Set(q(`SELECT j.employee_id, j.instrument_id FROM staff_employee_instruments j JOIN staff_employees e ON e.id = j.employee_id WHERE e.tier2_lab_id = ?`, LAB).map((r) => `${r.employee_id}|${r.instrument_id}`));

// Signer candidates, built the way the server builds them (loadCompetencySignerCandidates).
const roleRows = q(`SELECT e.id, e.first_name, e.last_name, r.role, r.specialty_number, r.all_specialties FROM staff_roles r JOIN staff_employees e ON e.id = r.employee_id
  WHERE e.tier2_lab_id = ? AND e.status = 'active' AND r.role IN ('LD','TC','TS','GS')`, LAB);
const gsDelegated = new Set<number>();
for (const d of q("SELECT delegate_staff_employee_id, responsibilities_json FROM director_delegations WHERE lab_id = ? AND status = 'active' AND position = 'general_supervisor' AND delegate_staff_employee_id IS NOT NULL", LAB)) {
  try { if (JSON.parse(d.responsibilities_json || "{}").gs_orientation_training === true) gsDelegated.add(Number(d.delegate_staff_employee_id)); } catch { /* ignore */ }
}
const cand = new Map<number, SignerCandidate>();
for (const r of roleRows) {
  if (!cand.has(r.id)) cand.set(r.id, { staffEmployeeId: r.id, name: nameOf(r), roles: [], gsCompetencyDelegated: gsDelegated.has(r.id) });
  cand.get(r.id)!.roles.push({ role: r.role, specialty_number: r.specialty_number, all_specialties: r.all_specialties });
}
const candidates = Array.from(cand.values());
const md = String(lab.medical_director_name || "").trim();
if (md) { const m = candidates.find((c) => norm(c.name) === norm(md)); if (m) m.isMedicalDirector = true; else candidates.push({ staffEmployeeId: null, name: md, roles: [], isMedicalDirector: true }); }

// Programs and their method groups.
const programs = q("SELECT id, name, department, type, is_implicit, map_id FROM competency_programs WHERE lab_id = ?", LAB);
const mgsByProgram = new Map<number, any[]>();
for (const mg of q(`SELECT mg.* FROM competency_method_groups mg JOIN competency_programs p ON p.id = mg.program_id WHERE p.lab_id = ?`, LAB)) {
  let names: string[] = []; try { names = JSON.parse(mg.instruments || "[]").map((x: any) => String(x)); } catch { /* ignore */ }
  mgsByProgram.set(mg.program_id, [...(mgsByProgram.get(mg.program_id) || []), { ...mg, instrumentsLC: names.map(norm), instrumentNames: names }]);
}

const records = q(`SELECT a.*, p.name AS program_name, p.type AS program_type, p.is_implicit, p.department, ce.name AS ce_name, ce.staff_employee_id AS ce_staff_id,
  (SELECT COUNT(*) FROM competency_assessment_items ai WHERE ai.assessment_id = a.id) AS item_count
  FROM competency_assessments a JOIN competency_programs p ON p.id = a.program_id JOIN competency_employees ce ON ce.id = a.employee_id
  WHERE p.lab_id = ? ORDER BY a.assessment_date, a.id`, LAB);

const milestoneOf = (t: string): MethodMilestone | null => {
  const u = norm(t);
  if (u === "initial") return "initial";
  if (u === "six_month" || u === "semiannual" || u === "6-month" || u === "six month") return "six_month";
  if (u === "first_annual") return "first_annual";
  if (u === "annual") return "annual";
  return null;
};

type Carry = { person: string; staffId: number; method: string; instrumentId: number; department: string; complexity: string; competency: string; date: string; signer: string; signerRole: string; nextDue: string; nextDueWithMonth: string; elements: string; source: string };
type Issue = { person: string; program: string; record: number; date: string; issue: string; suggestion: string };
type Skip = { record: number; person: string; program: string; date: string; reason: string };
const carry: Carry[] = [], issues: Issue[] = [], skipped: Skip[] = [];
const seen = new Map<string, Carry>();

for (const a of records) {
  const date = String(a.assessment_date || "").slice(0, 10);
  if (a.is_implicit === 1) { skipped.push({ record: a.id, person: a.ce_name, program: a.program_name, date, reason: a.locked === 1 ? "Already in the new per-person record (signed under the old whole-record button)." : `Already in the new per-person record, not signed yet (${a.item_count} entries). Nothing to carry.` }); continue; }
  if (a.locked !== 1 || String(a.status) !== "pass") { skipped.push({ record: a.id, person: a.ce_name, program: a.program_name, date, reason: `Not a signed passing record (locked ${a.locked ?? 0}, status ${a.status}).` }); continue; }

  // Person.
  let person: any = null; let personNote = "";
  if (a.ce_staff_id) person = active.find((s) => s.id === a.ce_staff_id) || null;
  if (!person) {
    const m = byName.get(norm(a.ce_name)) || [];
    if (m.length === 1) { person = m[0]; personNote = "matched by name"; }
    else { issues.push({ person: a.ce_name, program: a.program_name, record: a.id, date, issue: m.length ? `${m.length} active VeritaStaff people are named "${a.ce_name}".` : `No active VeritaStaff person named "${a.ce_name}".`, suggestion: "Link the record to the right VeritaStaff person, then re-run." }); continue; }
  }
  const pName = nameOf(person);

  const milestone = milestoneOf(a.assessment_type);
  if (!milestone) { issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `Competency type "${a.assessment_type}" does not map to initial, 6-month, first annual or annual.`, suggestion: "Confirm which competency this was." }); continue; }

  // Methods: instruments the program's method groups name, on the map, assigned to the person.
  const mgs = mgsByProgram.get(a.program_id) || [];
  const named = insts.filter((i) => mgs.some((mg) => methodGroupCoversInstrument(mg, { nameLC: norm(i.instrument_name) })));
  if (!named.length) {
    const hint = insts.filter((i) => assigned.has(`${person.id}|${i.id}`) && (norm(i.instrument_name).includes(norm(a.program_name)) || norm(a.program_name).split(" ").some((w: string) => w.length > 3 && norm(i.instrument_name).includes(w))));
    issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `The "${a.program_name}" program names no instrument, so the record does not say which method it covers.`, suggestion: hint.length ? `Likely: ${hint.map((h) => h.instrument_name).join("; ")}. Confirm.` : "Name the instrument(s) this competency covers." });
    continue;
  }
  const mine = named.filter((i) => assigned.has(`${person.id}|${i.id}`));
  const notMine = named.filter((i) => !assigned.has(`${person.id}|${i.id}`));
  if (!mine.length) {
    issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `None of the program's ${named.length} instrument(s) are assigned to ${pName} in VeritaStaff.`, suggestion: `Assign the instruments ${pName} runs (program names: ${named.map((i) => i.instrument_name).join("; ")}), or confirm this record does not carry.` });
    continue;
  }
  const evalName = String(a.evaluator_name || "").trim();
  for (const inst of mine) {
    const cx = cxOf.get(inst.id) || "UNSPECIFIED";
    const opts = methodSignerOptions(candidates, cx, inst.category);
    const signer = evalName ? opts.find((o) => norm(o.name) === norm(evalName)) : undefined;
    const methodLabel = `${inst.instrument_name}`;
    if (!evalName) { issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `${methodLabel}: the record has no evaluator.`, suggestion: "Name who signed it." }); continue; }
    if (!signer) { issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `${methodLabel}: evaluator "${evalName}" is not a VeritaStaff person with an LD, TC, TS or GS role.`, suggestion: "Add the evaluator's role in VeritaStaff, or name who signed it." }); continue; }
    if (!signer.eligible) { issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `${methodLabel} (${cx.toLowerCase()}): ${signer.name} cannot sign it: ${signer.reason}.`, suggestion: "Add the matching role or specialty in VeritaStaff, or confirm a different signer." }); continue; }
    if (signer.staffEmployeeId != null && signer.staffEmployeeId === person.id) { issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `${methodLabel}: ${pName} is the evaluator on ${pName}'s own competency.`, suggestion: "Name who assessed this person (someone other than the person assessed)." }); continue; }
    const natural = milestone === "initial" ? (cx === "WAIVED" ? addMonths(date, 12) : addMonths(date, 6)) : milestone === "six_month" ? addMonths(date, 6) : addMonths(date, 12);
    const nextIsAnnual = milestone === "first_annual" || milestone === "annual" || (milestone === "initial" && cx === "WAIVED");
    const row: Carry = {
      person: pName, staffId: person.id, method: methodLabel, instrumentId: inst.id, department: inst.category || "", complexity: cx,
      competency: MILESTONE_LABEL[milestone], date, signer: signer.name, signerRole: signer.roleLabel,
      nextDue: natural, nextDueWithMonth: MONTH && nextIsAnnual ? (alignAnnualToMonth(natural, MONTH) || natural) : natural,
      elements: a.item_count ? `${a.item_count} entries on the record` : "None on the record (summary entry; the elements are on paper)",
      source: `${a.program_name}, record #${a.id}${personNote ? ` (${personNote})` : ""}`,
    };
    const key = `${person.id}|${inst.id}|${milestone}|${date}`;
    if (seen.has(key)) { issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `${methodLabel}: the same ${MILESTONE_LABEL[milestone].toLowerCase()} on ${date} is also in ${seen.get(key)!.source}.`, suggestion: "Carry it once." }); continue; }
    seen.set(key, row);
    carry.push(row);
  }
  if (notMine.length) issues.push({ person: pName, program: a.program_name, record: a.id, date, issue: `Also named by the program but not assigned to ${pName}: ${notMine.map((i) => i.instrument_name).join("; ")}.`, suggestion: "Nothing carries for these unless they are assigned to this person in VeritaStaff." });
}

// ---------- workbook ----------
const { default: ExcelJS } = await import("exceljs");
const wb = new ExcelJS.Workbook();
wb.creator = "Veritas Lab Services"; wb.created = new Date();
const TEAL = "FF01696F", ALT = "FFEBF3F8", BORDER = { style: "thin" as const, color: { argb: "FFD0D0D0" } };
const style = (ws: any, widths: number[]) => {
  ws.columns.forEach((c: any, i: number) => { c.width = widths[i] || 18; });
  const h = ws.getRow(1); h.height = 20;
  h.eachCell((c: any) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TEAL } }; c.font = { name: "Calibri", size: 11, bold: true, color: { argb: "FFFFFFFF" } }; c.alignment = { vertical: "middle", wrapText: true }; c.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }; });
  ws.eachRow((row: any, n: number) => { if (n === 1) return; row.eachCell((c: any) => { c.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } }; c.alignment = { vertical: "middle", wrapText: true }; c.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }; if (n % 2 === 0) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ALT } }; }); });
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
};
const about = wb.addWorksheet("About");
const people = new Set(carry.map((c) => c.person));
const lines: Array<[string, string]> = [
  ["What this is", `Dry run: how ${lab.lab_name}'s VeritaComp program records would carry over to per-method sign-off. Nothing has been written to the lab.`],
  ["Data", `Production backup copy taken ${new Date().toISOString().slice(0, 10)} (read-only).`],
  ["Records read", `${records.length} (${records.filter((r: any) => r.is_implicit !== 1).length} in department programs)`],
  ["Would carry over", `${carry.length} method sign-offs for ${people.size} people`],
  ["Needs a decision", `${issues.length}`],
  ["Not carried", `${skipped.length}`],
  ["How a record maps", "Person: the record's VeritaStaff link, else an exact name match to one active person. Method: an instrument the program names that is on VeritaMap and assigned to that person in VeritaStaff. Signer: the record's evaluator, checked against the per-method signer rules for that method."],
  ["Due dates", `Next due is figured from the record's date (annual + 12 months; initial + 6 months, waived initial + 12).${MONTH ? ` "With annual month" shows the date with the lab annual month set to month ${MONTH}.` : ""}`],
];
about.addRow(["Item", "Detail"]); for (const l of lines) about.addRow(l); style(about, [22, 110]);
const c1 = wb.addWorksheet("Would carry over");
c1.addRow(["Person", "Method (instrument)", "Department", "Complexity", "Competency", "Date", "Signed by", "Signer role", "Next due", ...(MONTH ? ["Next due with annual month"] : []), "Elements", "From"]);
for (const c of carry) c1.addRow([c.person, c.method, c.department, c.complexity, c.competency, c.date, c.signer, c.signerRole, c.nextDue, ...(MONTH ? [c.nextDueWithMonth] : []), c.elements, c.source]);
style(c1, [20, 40, 14, 12, 12, 12, 16, 18, 12, ...(MONTH ? [14] : []), 30, 30]);
const c2 = wb.addWorksheet("Needs a decision");
c2.addRow(["Person", "Program", "Record #", "Date", "Issue", "Suggestion"]);
for (const i of issues) c2.addRow([i.person, i.program, i.record, i.date, i.issue, i.suggestion]);
style(c2, [20, 20, 10, 12, 60, 50]);
const c3 = wb.addWorksheet("Not carried");
c3.addRow(["Record #", "Person", "Program", "Date", "Reason"]);
for (const s of skipped) c3.addRow([s.record, s.person, s.program, s.date, s.reason]);
style(c3, [10, 20, 20, 12, 70]);
await wb.xlsx.writeFile(OUT);

console.log(`lab ${LAB} ${lab.lab_name}: ${records.length} records read; would carry ${carry.length} method sign-offs for ${people.size} people; ${issues.length} need a decision; ${skipped.length} not carried`);
const byIssue = new Map<string, number>(); for (const i of issues) { const k = i.issue.replace(/"[^"]*"/g, '"…"').replace(/^[^:]*: /, "").slice(0, 70); byIssue.set(k, (byIssue.get(k) || 0) + 1); }
for (const [k, n] of byIssue) console.log(`  ${n} x ${k}`);
console.log("wrote", OUT);
