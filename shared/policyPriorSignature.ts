// shared/policyPriorSignature.ts
//
// A read-and-sign that happened in a lab's prior system, carried over with its original date (Michael 2026-11-06, Q207 = 1; Heywood's
// MediaLab report). The rules a person can check by reading: how a name matches the roster, and what the record has to say. The load
// script and the server both use these, so a row can't pass one and fail the other.
//
// A name matches a roster row only when the letters are the same in the same order. Case, spacing, periods, apostrophes and hyphens
// don't count; nothing else is forgiven. "Mike" is not "Michael", and a name in brackets is not stripped. Two roster rows with the same
// name match nobody. Anything else goes on a list for a person to look at, because a wrong match would put a signature on the wrong person.

export const PERSON_STATES = ["on_roster", "inactive_in_prior_system", "not_on_this_lab_roster", "kept_by_a_person"] as const;
export type PriorPersonState = (typeof PERSON_STATES)[number];

/** Case, spacing, periods, apostrophes and hyphens removed. Letters, order and brackets stay. */
export function personKey(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[.'’‘`]/g, "")
    .replace(/[-‐-―]/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

export type RosterPerson = { id: number; last_name: string | null; first_name: string | null; middle_initial?: string | null };

/** The ways this roster row's name can be written: "Last, First", and "Last, First M" when it has a middle initial. */
export function rosterKeys(p: RosterPerson): string[] {
  const base = `${p.last_name ?? ""}, ${p.first_name ?? ""}`;
  const keys = [personKey(base)];
  const mi = String(p.middle_initial ?? "").trim();
  if (mi) keys.push(personKey(`${base} ${mi}`));
  return keys;
}

export type PersonMatch = { kind: "one"; employeeId: number } | { kind: "none" } | { kind: "many"; count: number };

export function indexRoster(roster: RosterPerson[]): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (const p of roster) {
    for (const k of rosterKeys(p)) {
      const list = index.get(k) ?? [];
      if (!list.includes(p.id)) list.push(p.id);
      index.set(k, list);
    }
  }
  return index;
}

export function matchPerson(name: unknown, index: Map<string, number[]>): PersonMatch {
  const hits = index.get(personKey(name)) ?? [];
  if (hits.length === 1) return { kind: "one", employeeId: hits[0] };
  if (hits.length === 0) return { kind: "none" };
  return { kind: "many", count: hits.length };
}

/** "9/12/2025" or "2025-09-12" to "2025-09-12". Null when it isn't a real calendar date. */
export function priorDate(value: unknown): string | null {
  const s = String(value ?? "").trim();
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!us && !iso) return null;
  const [y, m, d] = us ? [Number(us[3]), Number(us[1]), Number(us[2])] : [Number(iso![1]), Number(iso![2]), Number(iso![3])];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 2 from "2.0" or "2.1". Null when it isn't a version. */
export function priorMajor(version: unknown): number | null {
  const m = String(version ?? "").trim().match(/^(\d+)(?:\.\d+)?$/);
  return m ? Number(m[1]) : null;
}

/**
 * What a carried signature on this version counts for. MediaLab asks for a sign-off per major version, and its report names the major
 * only, so a person who signed 2.0 of a document that came over at 2.1 had nothing left to sign there:
 *   - the same major as the version loaded counts as signed for the version loaded;
 *   - an earlier major is history only, and the person is asked when the document is assigned;
 *   - a later major than the one loaded can't be right, and is refused.
 */
export function priorVersionRelation(rowVersion: unknown, loadedVersion: unknown): "counts" | "older" | "newer" | "bad" {
  const a = priorMajor(rowVersion);
  const b = priorMajor(loadedVersion);
  if (a === null || b === null) return "bad";
  return a === b ? "counts" : a < b ? "older" : "newer";
}

export type PriorSignatureRow = {
  docNumber: string;
  version: string;
  personName: string;
  credentials?: string | null;
  sourceType?: string | null;
  assignedOn?: string | null;
  signedOn: string;
  personState: PriorPersonState;
  employeeId?: number | null;
  // A person looked at this name and chose this roster row, through the script's --people-map.
  confirmedByPerson?: boolean;
};

export type PriorSignatureBatch = {
  labId: number;
  expectedLabName: string;
  ownerUserId: number;
  sourceSystem: string;
  batch: string;
  loadedBy: string;
  rows: PriorSignatureRow[];
};

export const MAX_ROWS_PER_BATCH = 1000;

/** Why a batch can't be read at all, or null. A problem with one row is that row's own result. */
export function priorBatchProblem(b: any): string | null {
  if (!b || typeof b !== "object") return "The body must be JSON.";
  if (!Number.isInteger(b.labId) || b.labId <= 0) return "labId is required.";
  if (typeof b.expectedLabName !== "string" || !b.expectedLabName.trim()) return "expectedLabName is required.";
  if (!Number.isInteger(b.ownerUserId) || b.ownerUserId <= 0) return "ownerUserId is required.";
  for (const k of ["sourceSystem", "batch", "loadedBy"]) if (typeof b[k] !== "string" || !b[k].trim()) return `${k} is required.`;
  if (!Array.isArray(b.rows) || b.rows.length === 0) return "rows is required.";
  if (b.rows.length > MAX_ROWS_PER_BATCH) return `At most ${MAX_ROWS_PER_BATCH} rows at a time.`;
  return null;
}
