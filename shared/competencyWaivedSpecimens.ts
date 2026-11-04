// shared/competencyWaivedSpecimens.ts
//
// Waived method 1, blind specimen testing, can record more than one specimen (Cathy Thornton, RFGH, 2026-11-04: "add specimen button. Keeps all
// the stuff in one location"). Same shape as Element 5's samples (shared/competencyEl5Samples.ts): the first specimen stays in waived_evidence,
// waived_date and waived_initials, so every reader that predates the list keeps working. waived_specimens_json holds the whole list only when
// there is more than one, and the first specimen's text is always read from the columns, so an edit through the columns is never shadowed.
// passed on the row means every specimen passed: the method counts toward the two required only then.

export interface WaivedSpecimen { evidence: string; date: string; initials: string; passed: boolean }

export const WAIVED_BLIND_METHOD = 1;
// A guard against a runaway request, far above a real set of blind specimens.
export const WAIVED_MAX_SPECIMENS = 25;

const blank = (s: WaivedSpecimen) => !s.evidence && !s.date && !s.initials && !s.passed;

function oneSpecimen(raw: any): WaivedSpecimen {
  return {
    evidence: String(raw?.evidence ?? "").trim(),
    date: String(raw?.date ?? "").trim(),
    initials: String(raw?.initials ?? "").trim(),
    passed: raw?.passed === true || raw?.passed === 1 || raw?.passed === "1",
  };
}

/** Specimens as entered: trimmed, fully blank rows dropped, order kept. */
export function cleanWaivedSpecimens(input: unknown): WaivedSpecimen[] {
  const list = Array.isArray(input) ? input : [];
  return list.slice(0, WAIVED_MAX_SPECIMENS).map(oneSpecimen).filter((s) => !blank(s));
}

/** The values to store for the method's row: the first specimen's columns, plus the list when there is more than one. */
export function waivedSpecimenColumns(specimens: WaivedSpecimen[]): { evidence: string | null; date: string | null; initials: string | null; passed: boolean; json: string | null } {
  const first = specimens[0];
  return {
    evidence: first?.evidence || null,
    date: first?.date || null,
    initials: first?.initials || null,
    passed: specimens.length > 0 && specimens.every((s) => s.passed),
    json: specimens.length > 1 ? JSON.stringify(specimens) : null,
  };
}

/** Every specimen on a stored row. The first one's text comes from the columns; any further specimens from waived_specimens_json. */
export function waivedSpecimensFromRow(row: any): WaivedSpecimen[] {
  let stored: WaivedSpecimen[] = [];
  try {
    const v = row?.waived_specimens_json ? JSON.parse(row.waived_specimens_json) : [];
    if (Array.isArray(v)) stored = v.map(oneSpecimen);
  } catch { /* a malformed list reads as the one specimen in the columns */ }
  const first: WaivedSpecimen = {
    evidence: String(row?.waived_evidence ?? "").trim(),
    date: String(row?.waived_date ?? "").trim(),
    initials: String(row?.waived_initials ?? "").trim(),
    passed: stored.length ? stored[0].passed : !!row?.passed,
  };
  return [first, ...stored.slice(1)];
}

const mdy = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : d);

/** The evidence cell on a printed record and a signed set: the plain text for one specimen, each specimen spelled out for several. */
export function waivedEvidenceText(row: any): string {
  const list = waivedSpecimensFromRow(row);
  if (list.length < 2) return String(row?.waived_evidence ?? row?.evidence ?? "");
  return list.map((s, i) => `Specimen ${i + 1}: ${[s.evidence, s.passed ? "Pass" : "Not passed", s.date ? mdy(s.date) : "", s.initials].filter(Boolean).join(", ")}`).join("; ");
}
