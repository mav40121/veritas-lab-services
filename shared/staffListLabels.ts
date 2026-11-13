// VeritaStaff labels the Staff tab and the staff list download both print (2026-11-13), so the screen and the
// spreadsheet can't disagree. competencyBadgeLabel is the badge's text, read from the server's competencyStatus
// (server/competencyReminders.ts competencyView) and the saved schedule, in the order the badge always used.

export type CompetencyBadgeLabel = "Current" | "Due Soon" | "Overdue" | "Not cleared" | "Not set";

export interface CompetencyStatusLike {
  bucket?: string | null;
  cleared?: boolean | null;
  nextDue?: string | null;
}

export function competencyBadgeLabel(status: CompetencyStatusLike | null | undefined, hasSchedule: boolean): CompetencyBadgeLabel {
  if (!status) return "Not set";
  if (status.bucket === "overdue") return "Overdue";
  if (!hasSchedule) return "Not set";
  if (!status.cleared) return "Not cleared";
  if (status.bucket === "dueSoon30") return "Due Soon";
  return "Current";
}

/** Highest complexity as the Staff tab shows it. */
export function complexityLabel(c?: string | null): string {
  const v = String(c ?? "").trim().toUpperCase();
  return v === "H" || v === "HIGH" ? "High" : v === "M" || v === "MODERATE" ? "Moderate" : v === "W" || v === "WAIVED" ? "Waived" : (c || "Not set");
}

export interface StaffRoleLike {
  role: string;
  specialty_number?: number | null;
  all_specialties?: number | null;
}

/** "TS (Chemistry); TP": each role once, with its CMS specialty, or "entire lab" when it covers every specialty. */
export function formatStaffRoles(roles: StaffRoleLike[] | null | undefined, specialtyName: (n: number) => string | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of roles ?? []) {
    if (!r?.role) continue;
    let label = r.role;
    if (r.all_specialties) label = `${r.role} (entire lab)`;
    else if (r.specialty_number) label = `${r.role} (${specialtyName(r.specialty_number) ?? `specialty ${r.specialty_number}`})`;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out.join("; ");
}
