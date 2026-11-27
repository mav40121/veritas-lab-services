// shared/accreditorRefs.ts
//
// BUG-191 (owner pick 2026-11-27, option 1). The COLA criterion numbers and AABB standard numbers VeritaAssure supplies
// were never checked against the COLA criteria or the AABB Standards: VeritaScan's built-in items (client/src/lib/
// veritaScanData.ts aabb, cola), the CFR crosswalk (server/cfrRequirements.ts aabb_ids, cola_ids), the VeritaDC master list
// (server/veritapolicyMasterList.ts aabb_citations, cola_citations) and the VeritaCheck study PDF's reference box
// (server/pdfReport.ts REGULATORY_REFS). Until a source is checked, every screen, PDF, workbook and document that shows one
// of OUR numbers for it shows BEING_VERIFIED in its place. The numbers stay in the data files, because the check needs them.
//
// Only our built-in data goes through here. What a laboratory typed itself (a custom VeritaScan question, a custom
// VeritaDC entry, a finding's own citation) is shown as typed and never passed to these helpers.
//
// To turn a source back on once it is checked: take it off UNVERIFIED_REF_SOURCES. Nothing else changes.
// tests/integration/accreditor-refs-hidden.test.ts scans the code for a read of those fields that skips this file.

export type RefSource = "TJC" | "CAP" | "CFR" | "CLSI" | "COLA" | "AABB";

/** The sources whose built-in reference numbers haven't been checked yet. */
export const UNVERIFIED_REF_SOURCES: readonly RefSource[] = ["COLA", "AABB"];

/** What a reader sees where one of our unchecked numbers would be. */
export const BEING_VERIFIED = "Being verified";

const norm = (source: string) => String(source || "").trim().toUpperCase();

/** True when our built-in numbers for this source may be shown. */
export function refSourceVerified(source: string): boolean {
  return !UNVERIFIED_REF_SOURCES.includes(norm(source) as RefSource);
}

/**
 * One of our built-in reference values as it may be shown: the value itself for a checked source, BEING_VERIFIED for one
 * that isn't (whatever the value, "N/A" and blank included, since which items a source applies to came from the same
 * unchecked mapping). Callers keep their own handling of blank and "N/A" for checked sources.
 */
export function displayRef(source: string, value: string | null | undefined): string {
  if (!refSourceVerified(source)) return BEING_VERIFIED;
  return value ?? "";
}

/** The list form of displayRef, for sources stored as arrays (the CFR crosswalk, the VeritaCheck reference box). */
export function displayRefList(source: string, values: readonly string[] | null | undefined): string[] {
  if (!refSourceVerified(source)) return [BEING_VERIFIED];
  return Array.isArray(values) ? [...values] : [];
}

/** "A", "A and B", "A, B and C". */
export const joinRefNames = (names: readonly string[]) =>
  names.length <= 1 ? names.join("") : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * The sentence a document adds when it shows a column for an unchecked source, e.g. 'COLA and AABB references read "Being
 * verified" until they are checked against the source standards.' Empty when none of the given sources is unchecked.
 */
export function unverifiedRefNote(sources: readonly string[]): string {
  const pending = UNVERIFIED_REF_SOURCES.filter((s) => sources.some((x) => norm(x) === s));
  if (pending.length === 0) return "";
  return `${joinRefNames(pending)} references read "${BEING_VERIFIED}" until they are checked against the source standards.`;
}
