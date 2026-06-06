// Wave F PR F2 (2026-06-06). Controlled vocabulary for the
// staff_employees.title field. Shared between client (dialog Select) and
// server (boot-migration keyword backfill).
//
// Why codify: the free-text title input drifts ("MLS(ASCP)" vs "MLS (ASCP)"
// vs "MLS ASCP" vs "Medical Laboratory Scientist") and breaks roster
// queries. A codified `title_code` column gives stable identity; the
// display string `title` keeps the canonical form so existing renders
// (employee cards, list rows) need no change.
//
// CMS-209 is unaffected — the personnel report renders from
// qualifications_text, not title.
//
// "OTHER" is a permanent escape hatch for credentials we have not yet
// codified (state-specific licenses, foreign credentials, AAB/NCA legacy
// holders). The free-text path remains for those cases.

export interface StaffTitleOption {
  /** Codified value stored in staff_employees.title_code. */
  code: string;
  /** Canonical display label shown in the UI and stored in title. */
  label: string;
  /** Short grouping for the Select widget. */
  group: "Degree" | "ASCP" | "AMT" | "Other";
  /**
   * Keyword fragments used by the boot backfill. Matched case-insensitively
   * against the existing free-text title. First-match wins, so order the
   * options here from most-specific to most-generic.
   */
  keywords: string[];
}

export const STAFF_TITLE_OPTIONS: StaffTitleOption[] = [
  // ── Degree credentials ─────────────────────────────────────────────
  { code: "MD",      label: "MD",            group: "Degree", keywords: ["m.d.", "md"] },
  { code: "DO",      label: "DO",            group: "Degree", keywords: ["d.o.", "do "] },
  { code: "PhD",     label: "PhD",           group: "Degree", keywords: ["ph.d.", "phd"] },
  { code: "MS",      label: "MS",            group: "Degree", keywords: ["m.s.", "ms ", "master of science"] },
  { code: "BS_BA",   label: "BS / BA",       group: "Degree", keywords: ["b.s.", "b.a.", "bs ", "ba ", "bachelor"] },
  { code: "AS",      label: "AS",            group: "Degree", keywords: ["a.s.", "as ", "associate"] },
  { code: "HS_GED",  label: "High School / GED", group: "Degree", keywords: ["high school", "ged"] },

  // ── ASCP BOC credentials (specialist first, then specific certs,
  //    then generalist categories, so backfill keywords resolve cleanly)
  { code: "SBB_ASCP", label: "SBB(ASCP)",  group: "ASCP", keywords: ["sbb(ascp)", "sbb (ascp)", "sbb ascp"] },
  { code: "SC_ASCP",  label: "SC(ASCP)",   group: "ASCP", keywords: ["sc(ascp)", "sc (ascp)", "sc ascp"] },
  { code: "SH_ASCP",  label: "SH(ASCP)",   group: "ASCP", keywords: ["sh(ascp)", "sh (ascp)", "sh ascp"] },
  { code: "SM_ASCP",  label: "SM(ASCP)",   group: "ASCP", keywords: ["sm(ascp)", "sm (ascp)", "sm ascp"] },
  { code: "MB_ASCP",  label: "MB(ASCP)",   group: "ASCP", keywords: ["mb(ascp)", "mb (ascp)", "mb ascp"] },
  { code: "HTL_ASCP", label: "HTL(ASCP)",  group: "ASCP", keywords: ["htl(ascp)", "htl (ascp)", "htl ascp", "histotechnologist"] },
  { code: "HT_ASCP",  label: "HT(ASCP)",   group: "ASCP", keywords: ["ht(ascp)", "ht (ascp)", "ht ascp", "histotechnician"] },
  { code: "CT_ASCP",  label: "CT(ASCP)",   group: "ASCP", keywords: ["ct(ascp)", "ct (ascp)", "ct ascp", "cytotechnologist"] },
  { code: "MLS_ASCP", label: "MLS(ASCP)",  group: "ASCP", keywords: ["mls(ascp)", "mls (ascp)", "mls ascp", "medical laboratory scientist"] },
  { code: "MLT_ASCP", label: "MLT(ASCP)",  group: "ASCP", keywords: ["mlt(ascp)", "mlt (ascp)", "mlt ascp", "medical laboratory technician"] },
  { code: "MT_ASCP",  label: "MT(ASCP)",   group: "ASCP", keywords: ["mt(ascp)", "mt (ascp)", "mt ascp", "medical technologist"] },

  // ── AMT credentials ───────────────────────────────────────────────
  { code: "MT_AMT",   label: "MT(AMT)",    group: "AMT", keywords: ["mt(amt)", "mt (amt)", "mt amt"] },
  { code: "MLT_AMT",  label: "MLT(AMT)",   group: "AMT", keywords: ["mlt(amt)", "mlt (amt)", "mlt amt"] },

  // ── Escape hatch ──────────────────────────────────────────────────
  { code: "OTHER",    label: "Other (free text)", group: "Other", keywords: [] },
];

/** Lookup label by code. Returns the code itself if no canonical option matches. */
export function getStaffTitleLabel(code: string | null | undefined): string {
  if (!code) return "";
  const hit = STAFF_TITLE_OPTIONS.find((o) => o.code === code);
  return hit ? hit.label : code;
}

/**
 * Backfill: derive a title_code from an existing free-text title string.
 * Returns null when no keyword matches; the migration leaves title_code
 * NULL on those rows so the customer (or a later cleanup) can address
 * them deliberately. Matching is case-insensitive and substring-based.
 */
export function inferStaffTitleCode(freeText: string | null | undefined): string | null {
  if (!freeText) return null;
  const haystack = freeText.toLowerCase();
  for (const opt of STAFF_TITLE_OPTIONS) {
    if (opt.code === "OTHER") continue;
    for (const kw of opt.keywords) {
      if (haystack.includes(kw)) return opt.code;
    }
  }
  return null;
}

/** Group options for the Select widget. Preserves the array order above. */
export function getStaffTitleGroups(): Record<string, StaffTitleOption[]> {
  const groups: Record<string, StaffTitleOption[]> = {};
  for (const opt of STAFF_TITLE_OPTIONS) {
    if (!groups[opt.group]) groups[opt.group] = [];
    groups[opt.group].push(opt);
  }
  return groups;
}
