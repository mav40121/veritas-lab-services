// server/competencySelfEntry.ts
//
// A Staff login saving the factual data on their OWN competency record (shared/competencySelfEntry.ts has the rule and
// the field list). Everything here works out what to change from the stored row: updates name only the data columns, so
// no request can reach an observer, a verdict, an N/A or a sign-off. Routes: the person page's PUT .../my-data and
// My sign-offs' PUT /api/staff-portal-session/competencies/:id, both in server/routes.ts.

import { el5Columns, el5SamplesFromRow, type El5Sample } from "@shared/competencyEl5Samples";
import { WAIVED_METHOD_NAMES } from "@shared/competencyStatus";
import { WAIVED_BLIND_METHOD, waivedSpecimenColumns, waivedSpecimensFromRow } from "@shared/competencyWaivedSpecimens";
import { cleanSelfValue, mergeSelfSamples, mergeSelfSpecimens, SELF_ELEMENT_FIELDS, type SelfCleaned, type SelfFieldKind } from "@shared/competencySelfEntry";
import { resolveSeatPermission, type SeatPermissions } from "@shared/schema";

/** The active Staff seat this user holds in THIS lab, from the session, or null. */
export function staffSelfSeat(sqlite: any, userId: unknown, labId: unknown): { staff_employee_id: number; permissions: string | null } | null {
  const row = sqlite.prepare(
    `SELECT staff_employee_id, permissions FROM user_seats
      WHERE seat_user_id = ? AND lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL
      ORDER BY id LIMIT 1`
  ).get(Number(userId), Number(labId)) as any;
  return row ? { staff_employee_id: Number(row.staff_employee_id), permissions: row.permissions ?? null } : null;
}

const seatEdits = (permissions: string | null, module: string): boolean => {
  try { return resolveSeatPermission(JSON.parse(permissions || "{}") as SeatPermissions, module) === "edit"; } catch { return false; }
};

/** Whose competency data a Staff login may read in one lab: their own roster row, or nobody's when employeeId is null. */
export interface StaffOwnScope { employeeId: number | null }

/**
 * Staff logins see their own competency data only (Michael Q182 = 1, 2026-11-05). Null means this person isn't limited in this
 * lab, and the route runs as it always did. Otherwise they hold a staff_portal seat here, in any status and with or without a
 * roster link, so a deactivated or unlinked seat is limited to nobody's data rather than falling back to everyone's. These stay
 * unlimited: the lab's owner or admin, an org admin, anyone holding another live seat in this lab (an editor with a staff card,
 * a view-only reviewer), and a Staff seat given edit on this module. Checked per lab from the session; a seat in another lab
 * never counts. labId null (an unscoped route that resolved no lab) fails closed for someone with only a Staff seat.
 */
export function staffOwnScope(sqlite: any, userId: unknown, labId: unknown, module = "veritacomp"): StaffOwnScope | null {
  const uid = Number(userId), lid = Number(labId);
  const seats = (lid > 0
    ? sqlite.prepare(
        `SELECT seat_type, status, permissions FROM user_seats
          WHERE seat_user_id = ? AND (lab_id = ? OR (lab_id IS NULL AND owner_user_id = (SELECT owner_user_id FROM labs WHERE id = ?)))`
      ).all(uid, lid, lid)
    : sqlite.prepare("SELECT seat_type, status, permissions FROM user_seats WHERE seat_user_id = ?").all(uid)) as any[];
  const staffSeats = seats.filter((s) => s.seat_type === "staff_portal");
  if (!staffSeats.length) return null;
  if (seats.some((s) => s.status === "active" && s.seat_type !== "staff_portal")) return null;
  if (staffSeats.some((s) => s.status === "active" && seatEdits(s.permissions, module))) return null;
  const manages = lid > 0
    ? sqlite.prepare(
        `SELECT 1 FROM labs WHERE id = ? AND owner_user_id = ?
         UNION SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' AND role IN ('owner','admin')
         UNION SELECT 1 FROM organization_members om JOIN labs l ON l.organization_id = om.organization_id
                WHERE l.id = ? AND om.user_id = ? AND om.status = 'active' AND om.org_role IN ('org_owner','org_admin')
         LIMIT 1`
      ).get(lid, uid, lid, uid, lid, uid)
    : sqlite.prepare("SELECT 1 FROM labs WHERE owner_user_id = ? LIMIT 1").get(uid);
  if (manages) return null;
  const own = lid > 0 ? staffSelfSeat(sqlite, uid, lid) : null;
  return { employeeId: own ? own.staff_employee_id : null };
}

/** A Staff seat in this lab with edit on any of these modules: the VeritaTrack and VeritaPT pickers need the names (GET staff/employees?names=1). */
export function staffSeatEditsAny(sqlite: any, userId: unknown, labId: unknown, modules: string[]): boolean {
  const seats = sqlite.prepare(
    "SELECT permissions FROM user_seats WHERE seat_user_id = ? AND lab_id = ? AND seat_type = 'staff_portal' AND status = 'active'"
  ).all(Number(userId), Number(labId)) as any[];
  return seats.some((s) => modules.some((m) => seatEdits(s.permissions, m)));
}

export interface SelfOps { updates: Array<{ id: number; sets: Record<string, any> }>; inserts: Array<Record<string, any>>; deletes: number[] }
const noOps = (): SelfOps => ({ updates: [], inserts: [], deletes: [] });
export const selfOpsCount = (o: SelfOps): number => o.updates.length + o.inserts.length + o.deletes.length;

// "" and NULL both mean blank; a stored score is a number and an entered one may be text.
const norm = (v: any): string | null => (v == null || v === "" ? null : String(v));
const has = (o: any, k: string): boolean => o != null && Object.prototype.hasOwnProperty.call(o, k);

const changedColumns = (next: Record<string, any>, stored: any): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const col of Object.keys(next)) if (norm(next[col]) !== norm(stored?.[col])) out[col] = next[col];
  return out;
};

const anyValue = (o: Record<string, any>, zeroCounts = false): boolean => Object.keys(o).some((k) => o[k] != null && o[k] !== "" && (zeroCounts || o[k] !== 0));

/**
 * A moderate or high complexity test system. `rows` are this method's working rows; `elements` are the same elements as
 * the person page shows them, the source of the evaluator-owned values when a row has to be created (a method still
 * showing an older program record keeps what it showed, as the evaluator's own save would).
 */
export function planSelfElements(args: { rows: any[]; elements: any[]; elementCount: number; input: unknown; instrumentName: string; instrumentId: number }): { ops?: SelfOps; error?: string } {
  const { rows, elements, elementCount, input, instrumentName, instrumentId } = args;
  if (!Array.isArray(input)) return { error: `${instrumentName}: enter each element's data.` };
  const byNum = new Map<number, any>();
  for (const el of input) {
    const n = Number(el?.num);
    if (!Number.isInteger(n) || n < 1 || n > elementCount) return { error: `Unknown element ${el?.num}.` };
    byNum.set(n, el);
  }
  const ops = noOps();
  for (let n = 1; n <= elementCount; n++) {
    const row = rows.find((r) => Number(r.element_number ?? r.method_number) === n) ?? null;
    const shown = elements.find((e) => Number(e.num) === n) ?? {};
    const d = byNum.get(n);
    const label = `Element ${n}`;
    const next: Record<string, any> = {};
    if (d && SELF_ELEMENT_FIELDS[n]) {
      if (n === 5) {
        const stored: El5Sample[] = row ? el5SamplesFromRow(row) : (shown.samples || []);
        const list = Array.isArray(d.samples) ? d.samples
          : (has(d, "sampleType") || has(d, "sampleId"))
            ? [{ ...(has(d, "sampleType") ? { sampleType: d.sampleType } : {}), ...(has(d, "sampleId") ? { sampleId: d.sampleId } : {}) }, ...stored.slice(1)]
            : null;
        if (list) {
          const merged = mergeSelfSamples(stored, list, label);
          if (merged.error) return { error: merged.error };
          const c = el5Columns(merged.samples!);
          Object.assign(next, { el5_sample_type: c.type, el5_sample_id: c.id, el5_acceptable: c.acceptable, el5_samples_json: c.json });
        }
      } else {
        for (const [key, field] of Object.entries(SELF_ELEMENT_FIELDS[n])) {
          if (!has(d, key)) continue;
          const v = cleanSelfValue(field.kind as SelfFieldKind, d[key], label);
          if (v.error) return { error: v.error };
          next[field.column] = v.value;
        }
      }
    }
    // What the row holds, or will start from when a row has to be created.
    const shown5 = n === 5 ? el5Columns(shown.samples || []) : null;
    const base: Record<string, any> = row ?? {
      el1_specimen_id: n === 1 ? shown.specimenId : null, el2_evidence: n === 2 ? shown.evidence : null, el2_date: n === 2 ? shown.date : null,
      el3_qc_date: n === 3 ? shown.qcDate : null, el5_sample_type: shown5?.type ?? null, el5_sample_id: shown5?.id ?? null,
      el5_acceptable: shown5?.acceptable ?? null, el5_samples_json: shown5?.json ?? null,
      el6_quiz_id: n === 6 ? shown.quizId : null, el6_score: n === 6 ? shown.score : null, el6_date_taken: n === 6 ? shown.dateTaken : null,
    };
    const changed = changedColumns(next, base);
    const naNow = row ? !!row[`el${n}_na`] : !!shown.na;
    if (naNow && Object.keys(changed).length) return { error: `${label}: your evaluator marked this N/A, so it takes no entry.` };
    if (row) {
      if (!Object.keys(changed).length) continue;
      // Entries the person took back, on a row the evaluator never touched, leave no row: a blank row would keep the method
      // in progress and would block the evaluator from unlocking its earlier sign-off.
      const after = { ...row, ...changed };
      const prefix = `el${n}_`;
      const empty = !after.passed && Object.keys(after).every((k) => !k.startsWith(prefix) || after[k] == null || after[k] === "" || (after[k] === 0 && k !== "el5_acceptable"));
      if (empty) ops.deletes.push(Number(row.id));
      else ops.updates.push({ id: Number(row.id), sets: changed });
      continue;
    }
    const evaluatorOwned: Record<string, any> = {
      passed: shown.passed ? 1 : 0,
      [`el${n}_na`]: shown.na ? 1 : 0,
      [`el${n}_na_justification`]: shown.na ? (shown.naJustification || null) : null,
      ...(n === 1 || n === 4 || n === 7 ? { [`el${n}_observer_initials`]: shown.observerInitials || null } : {}),
      ...(n === 4 || n === 7 ? { [`el${n}_date_observed`]: shown.dateObserved || null } : {}),
      ...(n === 8 ? { el8_function_assessed: shown.functionAssessed || null, el8_date: shown.date || null } : {}),
    };
    const data: Record<string, any> = {};
    for (const col of Object.keys(base)) if (col.startsWith(`el${n}_`) && base[col] != null && base[col] !== "") data[col] = base[col];
    Object.assign(data, next);
    // A blank Save starts nothing: no row, and the method stays Not started.
    if (!anyValue(data, true) && !anyValue(evaluatorOwned)) continue;
    ops.inserts.push({ instrument_id: instrumentId, method_number: n, element_number: n, item_label: instrumentName, method_group_name: instrumentName, ...evaluatorOwned, ...data });
  }
  return { ops };
}

/**
 * One waived method: the columns the person's entry leads to, given its stored row (null when there is none yet). Pass
 * and initials come from the stored row whatever was sent. A method's row passes only when every specimen did
 * (shared/competencyWaivedSpecimens.ts), so adding a specimen the evaluator hasn't marked takes the method back to not
 * passed until they do.
 */
export function selfWaivedRowSets(row: any | null, num: number, input: any): { sets?: Record<string, any>; blank?: boolean; error?: string } {
  const name = WAIVED_METHOD_NAMES[num - 1];
  if (num === WAIVED_BLIND_METHOD) {
    const stored = row ? waivedSpecimensFromRow(row) : [];
    const list = Array.isArray(input?.specimens) ? input.specimens
      : [{ ...(has(input, "evidence") ? { evidence: input.evidence } : {}), ...(has(input, "date") ? { date: input.date } : {}) }, ...stored.slice(1).map((s) => ({ evidence: s.evidence, date: s.date }))];
    const merged = mergeSelfSpecimens(stored, list, name);
    if (merged.error) return { error: merged.error };
    const specimens = merged.specimens!;
    if (specimens.some((s) => s.passed && !s.date)) return { error: `${name}: enter the date each passed specimen was performed.` };
    const c = waivedSpecimenColumns(specimens);
    return { sets: { waived_evidence: c.evidence, waived_date: c.date, waived_initials: c.initials, passed: c.passed ? 1 : 0, waived_specimens_json: c.json }, blank: specimens.length === 0 };
  }
  const evidence: SelfCleaned = has(input, "evidence") ? cleanSelfValue("text", input.evidence, name) : { value: row?.waived_evidence ?? null };
  if (evidence.error) return { error: evidence.error };
  const date: SelfCleaned = has(input, "date") ? cleanSelfValue("date", input.date, name) : { value: row?.waived_date ?? null };
  if (date.error) return { error: date.error };
  const passed = !!row?.passed, initials = String(row?.waived_initials ?? "").trim();
  if (passed && !date.value) return { error: `${name}: enter the date it was performed.` };
  return { sets: { waived_evidence: evidence.value ?? null, waived_date: date.value ?? null }, blank: !evidence.value && !date.value && !passed && !initials };
}

/** An all-waived test system on the person page. A method left fully blank has no row, the same as the evaluator's save. */
export function planSelfWaivedMethods(args: { rows: any[]; input: unknown; instrumentName: string; instrumentId: number }): { ops?: SelfOps; error?: string } {
  const { rows, input, instrumentName, instrumentId } = args;
  if (!Array.isArray(input)) return { error: `${instrumentName} is a waived test system: record two of the four waived methods.` };
  const ops = noOps();
  const seen = new Set<number>();
  for (const m of input) {
    const num = Number(m?.num);
    if (!Number.isInteger(num) || num < 1 || num > WAIVED_METHOD_NAMES.length) return { error: `Unknown waived method ${m?.num}.` };
    if (seen.has(num)) return { error: `Waived method ${num} was sent twice.` };
    seen.add(num);
    const row = rows.find((r) => Number(r.waived_method_number) === num) ?? null;
    const r = selfWaivedRowSets(row, num, m);
    if (r.error) return { error: r.error };
    if (row) {
      if (r.blank) { ops.deletes.push(Number(row.id)); continue; }
      const changed = changedColumns(r.sets!, row);
      if (Object.keys(changed).length) ops.updates.push({ id: Number(row.id), sets: changed });
    } else if (!r.blank) {
      ops.inserts.push({
        instrument_id: instrumentId, method_number: null, element_number: null, item_label: WAIVED_METHOD_NAMES[num - 1], method_group_name: instrumentName,
        waived_instrument: instrumentName, waived_method_number: num, passed: 0, waived_initials: null, ...r.sets,
      });
    }
  }
  return { ops };
}

// My sign-offs' whitelist, the same nine columns as the person page, keyed as that screen sends them.
const PORTAL_DATA_FIELDS: Record<string, { column: string; kind: SelfFieldKind }> = {
  el1SpecimenId: { column: "el1_specimen_id", kind: "text" },
  el2Evidence: { column: "el2_evidence", kind: "text" },
  el2Date: { column: "el2_date", kind: "date" },
  el3QcDate: { column: "el3_qc_date", kind: "date" },
  el5SampleType: { column: "el5_sample_type", kind: "text" },
  el5SampleId: { column: "el5_sample_id", kind: "text" },
  el6QuizId: { column: "el6_quiz_id", kind: "text" },
  el6Score: { column: "el6_score", kind: "number" },
  el6DateTaken: { column: "el6_date_taken", kind: "date" },
};

/**
 * A program record in My sign-offs: UPDATE-only on this record's existing rows. A row that isn't on this record, or one
 * already signed, refuses the whole save rather than being skipped.
 */
export function planSelfRecordRows(args: { rows: any[]; items: unknown; waivedItems: unknown }): { ops?: SelfOps; error?: string; status?: number } {
  const { rows, items, waivedItems } = args;
  const ops = noOps();
  const rowFor = (raw: any): { row?: any; error?: string; status?: number } => {
    const id = Number(raw?.id);
    if (!Number.isInteger(id)) return { error: "An entry doesn't name a row on this record.", status: 400 };
    const row = rows.find((r) => Number(r.id) === id);
    if (!row) return { error: "An entry isn't on this record.", status: 400 };
    if (row.signoff_id != null) return { error: "This entry is signed and can't be changed. Ask your evaluator to unlock it.", status: 409 };
    return { row };
  };
  for (const it of (Array.isArray(items) ? items : [])) {
    const found = rowFor(it);
    if (found.error) return { error: found.error, status: found.status! };
    const row = found.row;
    if (row.waived_method_number != null) return { error: "That entry is a waived method.", status: 400 };
    const element = Number(row.element_number ?? row.method_number);
    const next: Record<string, any> = {};
    for (const [key, field] of Object.entries(PORTAL_DATA_FIELDS)) {
      if (!has(it, key)) continue;
      const v = cleanSelfValue(field.kind, it[key], `Element ${field.column.charAt(2)}`);
      if (v.error) return { error: v.error, status: 400 };
      next[field.column] = v.value;
    }
    const changed = changedColumns(next, row);
    if (!Object.keys(changed).length) continue;
    if (row[`el${element}_na`]) return { error: `Element ${element}: your evaluator marked this N/A, so it takes no entry.`, status: 400 };
    ops.updates.push({ id: Number(row.id), sets: changed });
  }
  for (const w of (Array.isArray(waivedItems) ? waivedItems : [])) {
    const found = rowFor(w);
    if (found.error) return { error: found.error, status: found.status! };
    const row = found.row;
    const num = Number(row.waived_method_number);
    if (!Number.isInteger(num) || num < 1 || num > WAIVED_METHOD_NAMES.length) return { error: "That entry is not a waived method.", status: 400 };
    const r = selfWaivedRowSets(row, num, w);
    if (r.error) return { error: r.error, status: 400 };
    const changed = changedColumns(r.sets!, row);
    if (Object.keys(changed).length) ops.updates.push({ id: Number(row.id), sets: changed });
  }
  return { ops };
}

/** Apply a plan inside the caller's transaction. Column names come only from the plans above, never from a request. */
export function applySelfOps(sqlite: any, assessmentId: number, ops: SelfOps): void {
  for (const u of ops.updates) {
    const cols = Object.keys(u.sets);
    sqlite.prepare(`UPDATE competency_assessment_items SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ? AND assessment_id = ? AND signoff_id IS NULL`)
      .run(...cols.map((c) => u.sets[c]), u.id, assessmentId);
  }
  for (const id of ops.deletes) {
    sqlite.prepare("DELETE FROM competency_assessment_items WHERE id = ? AND assessment_id = ? AND signoff_id IS NULL").run(id, assessmentId);
  }
  for (const ins of ops.inserts) {
    const cols = Object.keys(ins);
    sqlite.prepare(`INSERT INTO competency_assessment_items (assessment_id, ${cols.join(", ")}) VALUES (?, ${cols.map(() => "?").join(", ")})`)
      .run(assessmentId, ...cols.map((c) => ins[c]));
  }
}
