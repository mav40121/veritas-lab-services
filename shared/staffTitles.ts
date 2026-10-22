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
//
// 2026-10-21 (Angie Cedeno): one person often holds several credentials
// ("BS / BA, MLT(ASCP), MT(AMT)"), and ASCP's international credentials
// (ASCPi) were missing. An employee now carries any number of codified
// credentials plus any number of custom entries:
//   title      = display string, labels in option order then custom entries,
//                joined with ", " (renders unchanged everywhere it did before)
//   title_code = the codes joined with ",", plus "OTHER" when there is a custom
//                entry. A single legacy code ("MLS_ASCP") is the one-element case.
// buildCredentialFields / parseCredentialFields convert between the two.

export interface StaffTitleOption {
  /** Codified value stored in staff_employees.title_code. */
  code: string;
  /** Canonical display label shown in the UI and stored in title. */
  label: string;
  /** Short grouping for the Select widget. */
  group: "Degree" | "ASCP" | "ASCPi" | "AMT" | "Other";
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

  // ── ASCP BOC international credentials (ASCPi). No backfill keywords:
  //    the boot backfill in server/db.ts mirrors the keyword lists in SQL,
  //    and these are picked by hand, never inferred.
  { code: "MLS_ASCPI", label: "MLS(ASCPi)", group: "ASCPi", keywords: [] },
  { code: "MLT_ASCPI", label: "MLT(ASCPi)", group: "ASCPi", keywords: [] },
  { code: "MB_ASCPI",  label: "MB(ASCPi)",  group: "ASCPi", keywords: [] },
  { code: "BB_ASCPI",  label: "BB(ASCPi)",  group: "ASCPi", keywords: [] },
  { code: "C_ASCPI",   label: "C(ASCPi)",   group: "ASCPi", keywords: [] },
  { code: "H_ASCPI",   label: "H(ASCPi)",   group: "ASCPi", keywords: [] },
  { code: "M_ASCPI",   label: "M(ASCPi)",   group: "ASCPi", keywords: [] },
  { code: "CT_ASCPI",  label: "CT(ASCPi)",  group: "ASCPi", keywords: [] },
  { code: "HTL_ASCPI", label: "HTL(ASCPi)", group: "ASCPi", keywords: [] },
  { code: "HT_ASCPI",  label: "HT(ASCPi)",  group: "ASCPi", keywords: [] },
  { code: "PBT_ASCPI", label: "PBT(ASCPi)", group: "ASCPi", keywords: [] },

  // ── AMT credentials ───────────────────────────────────────────────
  { code: "MT_AMT",   label: "MT(AMT)",    group: "AMT", keywords: ["mt(amt)", "mt (amt)", "mt amt"] },
  { code: "MLT_AMT",  label: "MLT(AMT)",   group: "AMT", keywords: ["mlt(amt)", "mlt (amt)", "mlt amt"] },

  // ── Escape hatch ──────────────────────────────────────────────────
  // Marks a custom (free-text) entry in title_code. Not offered in the picker:
  // custom entries are typed into their own box.
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

/** Picker groups: every codified credential, without the OTHER marker. */
export function getCredentialPickerGroups(): Record<string, StaffTitleOption[]> {
  const groups = getStaffTitleGroups();
  delete groups.Other;
  return groups;
}

const CODED = STAFF_TITLE_OPTIONS.filter((o) => o.code !== "OTHER");

/**
 * Codes (any order, duplicates and unknown codes dropped) plus custom entries
 * -> the stored title and title_code. Codes come out in option order; custom
 * entries keep their order after them. A custom entry that matches a codified
 * label (case-insensitive, spaces ignored) is stored as that code instead.
 */
export function buildCredentialFields(codes: string[], customs: string[]): { title: string; titleCode: string } {
  const norm = (v: string) => v.toLowerCase().replace(/\s+/g, "");
  const picked = new Set(codes);
  const extra: string[] = [];
  for (const raw of customs) {
    const c = raw.trim();
    if (!c) continue;
    const hit = CODED.find((o) => norm(o.label) === norm(c));
    if (hit) picked.add(hit.code);
    else if (!extra.some((e) => norm(e) === norm(c))) extra.push(c);
  }
  const ordered = CODED.filter((o) => picked.has(o.code));
  const title = [...ordered.map((o) => o.label), ...extra].join(", ");
  const titleCode = [...ordered.map((o) => o.code), ...(extra.length ? ["OTHER"] : [])].join(",");
  return { title, titleCode };
}

/**
 * Stored title + title_code -> the codes and custom entries to show in the
 * picker. Handles the legacy single-code rows: when the stored title is not the
 * labels the codes would build (a keyword-backfilled title such as "Medical
 * Laboratory Scientist"), the codes still show and the title is left as stored
 * until someone changes the credentials.
 */
export function parseCredentialFields(title: string | null | undefined, titleCode: string | null | undefined): { codes: string[]; customs: string[] } {
  const parts = (titleCode || "").split(",").map((c) => c.trim()).filter(Boolean);
  const codes = CODED.filter((o) => parts.includes(o.code)).map((o) => o.code);
  const t = (title || "").trim();
  const prefix = CODED.filter((o) => codes.includes(o.code)).map((o) => o.label).join(", ");
  let rest = "";
  if (!prefix) rest = t;
  else if (t === prefix) rest = "";
  else if (t.startsWith(prefix + ", ")) rest = t.slice(prefix.length + 2);
  const customs = rest ? rest.split(", ").map((c) => c.trim()).filter(Boolean) : [];
  return { codes, customs };
}
