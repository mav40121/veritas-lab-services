// shared/policyVersion.ts
//
// VeritaDC document numbers and major.minor versions (Michael 2026-11-03, Q151/Q154; parity plan Phase 1 item 2, for
// Heywood's MediaLab library, which numbers documents "183079.624" / "AH 12" and versions them 1.0, 1.1, 2.0).
//
// Versions: policy_versions.version_number stays the internal order key (file paths, history order). The label a person
// sees is major.minor from version_major / version_minor. Versions saved before these columns existed have them NULL and
// read as "<version_number>.0", so v1, v2 keep their meaning as 1.0, 2.0 and no stored row is rewritten. A major
// revision moves to the next whole number; any other new version adds .1 within the current major.

export type VersionRow = {
  version_number: number;
  version_major?: number | null;
  version_minor?: number | null;
};

export function versionParts(v: VersionRow): { major: number; minor: number } {
  if (v.version_major != null) return { major: Number(v.version_major), minor: Number(v.version_minor ?? 0) };
  return { major: Number(v.version_number), minor: 0 };
}

export function versionLabel(v: VersionRow | null | undefined): string | null {
  if (!v || v.version_number == null) return null;
  const { major, minor } = versionParts(v);
  return `${major}.${minor}`;
}

/** The major.minor for the next version of a document, given its existing versions. */
export function nextVersionParts(existing: VersionRow[], isMajor: boolean): { major: number; minor: number } {
  if (existing.length === 0) return { major: 1, minor: 0 };
  const parts = existing.map(versionParts);
  const topMajor = Math.max(...parts.map((p) => p.major));
  if (isMajor) return { major: topMajor + 1, minor: 0 };
  const topMinor = Math.max(...parts.filter((p) => p.major === topMajor).map((p) => p.minor));
  return { major: topMajor, minor: topMinor + 1 };
}

// Document numbers: the lab's own identifier, kept as text exactly as the lab writes it (spaces collapsed, ends trimmed).
export const DOC_NUMBER_MAX = 60;

/** null when blank; "bad" when too long; otherwise the cleaned number. */
export function cleanDocNumber(raw: unknown): string | null | "bad" {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > DOC_NUMBER_MAX ? "bad" : s;
}

/** Comparison key for uniqueness within a lab: case-insensitive. */
export const docNumberKey = (s: string) => s.toLowerCase();
