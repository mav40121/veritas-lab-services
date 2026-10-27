// shared/veritatrackCategories.ts
//
// VeritaTrack categories and frequencies, shared by the server and the page.
// #110 (Michael 2026-10-26): "Be able to, by lab, add custom categories instead of just our defaults." The built-in
// categories below stay for every lab; a lab's owners and admins add their own (veritatrack_categories), rename them,
// or retire them. A retired category stays on the tasks that already use it but is no longer offered for new ones.
// #111 (Michael 2026-10-26): "add a weekly option for frequency." Weekly is a 7-day interval; the rest are months.
// No em dashes in any user-facing string (CLAUDE.md section 3).

export const DEFAULT_TRACK_CATEGORIES: readonly string[] = [
  "Calibration Verification", "Correlation", "Precision Verification",
  "Policy Review", "QC Review", "Water Contamination",
  "Blood Bank Alarm Checks", "Equipment Calibration",
  "Competency", "Quality Assessment", "HIPAA", "Bloodborne Pathogen",
  "Other",
];

export const TRACK_FREQUENCIES: readonly { label: string; value: string; months: number; days: number | null }[] = [
  { label: "Weekly",    value: "Weekly",    months: 0,  days: 7 },
  { label: "Monthly",   value: "Monthly",   months: 1,  days: null },
  { label: "Quarterly", value: "Quarterly", months: 3,  days: null },
  { label: "Biannual",  value: "Biannual",  months: 6,  days: null },
  { label: "Annual",    value: "Annual",    months: 12, days: null },
  { label: "Biennial",  value: "Biennial",  months: 24, days: null },
];

export const CATEGORY_NAME_MAX = 60;

// Collapse inner whitespace and trim, so "  Safety   Checks " and "Safety Checks" are one category.
export function cleanCategoryName(name: unknown): string {
  return String(name ?? "").replace(/\s+/g, " ").trim();
}

export function isDefaultTrackCategory(name: string): boolean {
  const n = cleanCategoryName(name).toLowerCase();
  return DEFAULT_TRACK_CATEGORIES.some((c) => c.toLowerCase() === n);
}

// Why a proposed custom category name cannot be used, or null when it can. `taken` is the lab's other custom
// category names (retired ones included, so a retired name is brought back rather than duplicated).
export function categoryNameProblem(name: unknown, taken: readonly string[] = []): string | null {
  const n = cleanCategoryName(name);
  if (!n) return "Enter a category name.";
  if (n.length > CATEGORY_NAME_MAX) return `Keep the name to ${CATEGORY_NAME_MAX} characters or fewer.`;
  if (/[\u2014\u2013]/.test(n)) return "Use a hyphen instead of a dash."; // em or en dash (copy rule, CLAUDE.md section 3)
  if (isDefaultTrackCategory(n)) return `"${n}" is already a built-in category.`;
  if (taken.some((t) => cleanCategoryName(t).toLowerCase() === n.toLowerCase())) return `"${n}" already exists for this lab.`;
  return null;
}
