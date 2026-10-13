// CMS-209 Part B: pure role-shaping helpers for the "entire lab" TC/TS concept.
// Extracted from routes.ts so they are unit-testable in isolation
// (scripts/verify-cms209-partb.mts drives these exact functions). Anything that
// touches the database (reading/writing staff_lab_specialties, loading
// employees) stays in routes.ts; only the pure transforms live here.
//
// Background: on the real CMS-209, TC (moderate) and TS (high) hold a CMS
// specialty NUMBER (1-17). A director can scope a TC/TS to a specific specialty
// (specialty_number set) or to the ENTIRE lab (all_specialties = 1). An
// entire-lab role expands, at 209 generation, to one row per specialty the lab
// performs (its director-set list). The number never gets invented: an
// entire-lab role with no lab list, or a specific role with no number, is a gap.

export interface RoleRow {
  role: string;
  specialty_number?: number | null;
  all_specialties?: number | boolean | null;
}

export interface EmployeeWithRoles {
  id?: number;
  last_name?: string;
  first_name?: string;
  roles?: RoleRow[];
}

export interface Cms209Gap {
  employeeId?: number;
  name: string;
  role: string;
  reason: string;
}

// A TC/TS role the director scoped to the ENTIRE lab. Only TC and TS carry a
// specialty number on the 209, so the flag is meaningful only for them; every
// other role returns 0. Accepts a boolean or 1 from the client payload.
export function entireLabFlag(r: any): number {
  return r && (r.role === "TC" || r.role === "TS") && (r.allSpecialties === true || r.allSpecialties === 1) ? 1 : 0;
}

// Bound to 1-17, dedupe, sort ascending. Anything outside the CMS specialty
// range is dropped rather than trusted.
export function sanitizeSpecialties(input: any): number[] {
  if (!Array.isArray(input)) return [];
  const set = new Set<number>();
  for (const v of input) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 1 && n <= 17) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

// BUG-044 (2026-10-12, Redington-Fairview): ticking TC or TS in the VeritaStaff employee form saves a placeholder row
// with no specialty, and choosing specialties adds one row per specialty without removing it. So a TC/TS with real
// specialties also carries an empty row, which read as "no specialty number assigned" and would print a blank TC/TS line
// on the 209. A specialty-less, non-entire-lab TC/TS row is a leftover placeholder when the same person holds the same
// role with a specialty number or the entire-lab flag; it is skipped. A TC/TS with ONLY the empty row is still a gap.
export function isPlaceholderRole(r: RoleRow, all: RoleRow[]): boolean {
  if (r.role !== "TC" && r.role !== "TS") return false;
  if (r.specialty_number != null || r.all_specialties === 1 || r.all_specialties === true) return false;
  return all.some((o) => o !== r && o.role === r.role && (o.specialty_number != null || o.all_specialties === 1 || o.all_specialties === true));
}

// Turn any TC/TS role flagged all_specialties=1 into one role row per specialty
// the lab performs, so the real CMS-209 renders the whole-lab convention (one
// row per specialty, the number in both columns). Deduplicates on
// (role, specialty_number) so an entire-lab flag plus a stray explicit row
// cannot double a line. If the lab has no specialty list yet, an entire-lab
// role is preserved as a single specialty-less row so it still appears (and
// surfaces as needs-review) rather than silently vanishing.
export function expandEntireLabRoles<T extends EmployeeWithRoles>(
  employeesWithRoles: T[],
  labSpecialtyNumbers: number[],
): T[] {
  return employeesWithRoles.map((emp) => {
    const out: RoleRow[] = [];
    const seen = new Set<string>();
    const push = (role: string, sn: number | null) => {
      const key = `${role}:${sn ?? "null"}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ role, specialty_number: sn });
    };
    for (const r of emp.roles || []) {
      if (isPlaceholderRole(r, emp.roles || [])) continue; // BUG-044
      const isTcTs = r.role === "TC" || r.role === "TS";
      const entireLab = r.all_specialties === 1 || r.all_specialties === true;
      if (isTcTs && entireLab) {
        if (labSpecialtyNumbers.length > 0) {
          for (const sn of labSpecialtyNumbers) push(r.role, sn);
        } else {
          push(r.role, r.specialty_number ?? null);
        }
      } else {
        push(r.role, r.specialty_number ?? null);
      }
    }
    return { ...emp, roles: out } as T;
  });
}

// TC/TS roles that will render BLANK on the 209 because they have no specialty
// number and no usable entire-lab expansion. This is the surveyor "needs
// review" list; it never invents a specialty number.
export function cms209Gaps(
  employeesWithRoles: EmployeeWithRoles[],
  labSpecialtyNumbers: number[],
): Cms209Gap[] {
  const labHasList = labSpecialtyNumbers.length > 0;
  const gaps: Cms209Gap[] = [];
  for (const emp of employeesWithRoles) {
    for (const r of emp.roles || []) {
      if (r.role !== "TC" && r.role !== "TS") continue;
      if (isPlaceholderRole(r, emp.roles || [])) continue; // BUG-044
      const hasSpecialty = r.specialty_number != null;
      const entireLab = r.all_specialties === 1 || r.all_specialties === true;
      const name = `${emp.last_name}, ${emp.first_name}`;
      if (entireLab && !labHasList) {
        gaps.push({ employeeId: emp.id, name, role: r.role, reason: "scoped to entire lab, but the lab specialty list is empty" });
      } else if (!entireLab && !hasSpecialty) {
        gaps.push({ employeeId: emp.id, name, role: r.role, reason: "no specialty number assigned" });
      }
    }
  }
  return gaps;
}
