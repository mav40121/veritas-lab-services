// shared/competencySignoff.ts
//
// Per-method competency sign-off (Michael 2026-10-13, Q156 talk-through + Q158 = 1): each method (an instrument) is
// signed off on its own for each person, so a new hire can be signed department by department. Pure rules shared by
// the server (enforced on sign) and the client (the "Signed by" list): who may sign one method's competency.
//   Moderate method: a technical consultant or a technical supervisor for that specialty, or the laboratory director
//     (42 CFR 493.1413(b)(8), 493.1407(a)). A TS for a specialty meets the TC requirements for it (Michael, 2026-10-13,
//     Q159).
//   High method: a technical supervisor for that specialty (493.1451(b)(8)), a general supervisor the director or TS
//     delegated it to in a signed Letter of Delegation (493.1463(b)(4)), or the laboratory director (493.1445(a)).
//   Waived method: a general supervisor, technical consultant, technical supervisor or the laboratory director.
// Roles come from VeritaStaff (staff_roles, the CMS-209 roles). A TC/TS role scoped to specialties covers a method only
// when the method's department maps to one of them. An entire-lab role, a role with no specialty set, or a department
// that is not one CMS specialty (Point of Care, Manual Procedures, Molecular, ...) is not restricted.

export type MethodComplexity = "HIGH" | "MODERATE" | "WAIVED" | "UNSPECIFIED";
export type SignerRoleCode = "LD" | "TC" | "TS" | "GS";

export interface SignerRole { role: string; specialty_number?: number | null; all_specialties?: number | boolean | null }
export interface SignerCandidate {
  staffEmployeeId: number | null;
  name: string;
  roles: SignerRole[];
  gsCompetencyDelegated?: boolean; // an active Letter of Delegation grants this GS competency evaluation
  isMedicalDirector?: boolean;     // the lab's designated medical director (labs.medical_director_name)
}
export interface SignerOption {
  staffEmployeeId: number | null;
  name: string;
  role: SignerRoleCode | null;
  roleLabel: string;
  eligible: boolean;
  reason: string | null; // why not, when not eligible
}

export const SIGNER_ROLE_LABEL: Record<SignerRoleCode, string> = {
  LD: "Laboratory Director", TC: "Technical Consultant", TS: "Technical Supervisor", GS: "General Supervisor",
};

export const CMS_SPECIALTY_NAMES: Record<number, string> = {
  1: "Bacteriology", 2: "Mycobacteriology", 3: "Mycology", 4: "Parasitology", 5: "Virology", 6: "Diagnostic Immunology",
  7: "Chemistry", 8: "Hematology", 9: "Immunohematology", 10: "Radiobioassay", 11: "Cytology", 12: "Histopathology",
  13: "Dermatopathology", 14: "Ophthalmic Pathology", 15: "Oral Pathology", 16: "Histocompatibility", 17: "Clinical Cytogenetics",
};

// VeritaMap department (instrument category) -> the CMS-209 specialty numbers it falls under. Coagulation and ESR are
// hematology; urinalysis, blood gas, toxicology and endocrinology are chemistry. null = not a single CMS specialty, so
// no specialty restriction applies.
export function cmsSpecialtiesForDepartment(department: string | null | undefined): number[] | null {
  const d = String(department || "").trim().toLowerCase();
  if (!d) return null;
  const table: Array<[RegExp, number[]]> = [
    [/^(chemistry|general chemistry|routine chemistry|blood gas|blood gases|urinalysis|toxicology|toxicology \/ tdm|endocrinology)$/, [7]],
    [/^(hematology|coagulation|esr)$/, [8]],
    [/^(blood bank|immunohematology|transfusion service)$/, [9]],
    [/^(serology|syphilis serology|general immunology|immunology|immunology \/ protein|diagnostic immunology)$/, [6]],
    [/^microbiology$/, [1, 2, 3, 4, 5]],
    [/^bacteriology$/, [1]], [/^mycobacteriology$/, [2]], [/^mycology$/, [3]], [/^parasitology$/, [4]], [/^virology$/, [5]],
    [/^cytology$/, [11]], [/^(histology|histopathology|histology \/ pathology)$/, [12]],
  ];
  for (const [re, nums] of table) if (re.test(d)) return nums;
  return null;
}

const isScoped = (r: SignerRole) => r.specialty_number != null || r.all_specialties === 1 || r.all_specialties === true;

// Does the person hold `role` for a method in these specialties? Scoped rows decide when there are any; a specialty-less
// row next to scoped rows is the BUG-044 placeholder and is ignored. Only unscoped rows = not restricted.
function holdsRoleFor(roles: SignerRole[], role: SignerRoleCode, specs: number[] | null): boolean {
  const rows = roles.filter((r) => String(r.role).toUpperCase() === role);
  if (!rows.length) return false;
  const scoped = rows.filter(isScoped);
  if (!scoped.length || specs == null) return true;
  return scoped.some((r) => r.all_specialties === 1 || r.all_specialties === true || specs.includes(Number(r.specialty_number)));
}

function specialtyList(roles: SignerRole[], role: SignerRoleCode): string {
  const nums = roles.filter((r) => String(r.role).toUpperCase() === role && r.specialty_number != null).map((r) => Number(r.specialty_number));
  return Array.from(new Set(nums)).map((n) => CMS_SPECIALTY_NAMES[n] || `specialty ${n}`).join(", ");
}

export function normalizeComplexity(c: string | null | undefined): MethodComplexity {
  const u = String(c || "").trim().toUpperCase();
  return u.startsWith("H") ? "HIGH" : u.startsWith("M") ? "MODERATE" : u.startsWith("W") ? "WAIVED" : "UNSPECIFIED";
}

// One person's standing for one method: the role they would sign under, or why they cannot.
export function signerOptionFor(c: SignerCandidate, complexityIn: string | null | undefined, department: string | null | undefined): SignerOption | null {
  const complexity = normalizeComplexity(complexityIn);
  const specs = cmsSpecialtiesForDepartment(department);
  const has = (role: SignerRoleCode) => c.roles.some((r) => String(r.role).toUpperCase() === role);
  const isLD = has("LD") || !!c.isMedicalDirector;
  if (!isLD && !has("TC") && !has("TS") && !has("GS")) return null; // not a supervisory role: not listed
  const ok = (role: SignerRoleCode): SignerOption => ({ staffEmployeeId: c.staffEmployeeId, name: c.name, role, roleLabel: SIGNER_ROLE_LABEL[role], eligible: true, reason: null });
  const no = (role: SignerRoleCode, reason: string): SignerOption => ({ staffEmployeeId: c.staffEmployeeId, name: c.name, role, roleLabel: SIGNER_ROLE_LABEL[role], eligible: false, reason });
  const dept = String(department || "").trim() || "this department";

  if (complexity === "WAIVED") {
    for (const role of ["GS", "TC", "TS"] as SignerRoleCode[]) if (has(role)) return ok(role);
    return ok("LD");
  }
  if (complexity === "HIGH") {
    if (holdsRoleFor(c.roles, "TS", specs)) return ok("TS");
    if (has("GS") && c.gsCompetencyDelegated) return ok("GS");
    if (isLD) return ok("LD");
    if (has("TS")) return no("TS", `Technical supervisor for ${specialtyList(c.roles, "TS") || "other specialties"}, not ${dept}`);
    if (has("GS")) return no("GS", "General supervisor without a signed delegation for competency");
    return no("TC", "Technical consultant: high complexity needs a technical supervisor");
  }
  if (complexity === "MODERATE") {
    if (holdsRoleFor(c.roles, "TC", specs)) return ok("TC");
    if (holdsRoleFor(c.roles, "TS", specs)) return ok("TS"); // a TS for the specialty meets the TC requirements
    if (isLD) return ok("LD");
    if (has("TC")) return no("TC", `Technical consultant for ${specialtyList(c.roles, "TC") || "other specialties"}, not ${dept}`);
    if (has("TS")) return no("TS", `Technical supervisor for ${specialtyList(c.roles, "TS") || "other specialties"}, not ${dept}`);
    return no("GS", "General supervisor: moderate complexity needs a technical consultant or supervisor");
  }
  // Complexity not set on the map: a TC or TS for the specialty, or the director.
  if (holdsRoleFor(c.roles, "TS", specs)) return ok("TS");
  if (holdsRoleFor(c.roles, "TC", specs)) return ok("TC");
  if (isLD) return ok("LD");
  return no(has("GS") ? "GS" : has("TS") ? "TS" : "TC", "Complexity is not set for this instrument in VeritaMap");
}

const ROLE_ORDER: Record<string, number> = { TS: 0, TC: 0, GS: 1, LD: 2 };

// The "Signed by" list for one method: eligible people first (the role the method calls for, then GS, then the
// director), then the ineligible supervisors greyed out with the reason. The person being assessed never signs their
// own competency (Michael Q163 = 1, 2026-10-13), whatever roles they hold.
export function methodSignerOptions(candidates: SignerCandidate[], complexity: string | null | undefined, department: string | null | undefined, assessedStaffEmployeeId?: number | null): SignerOption[] {
  const opts = candidates.map((c) => {
    const o = signerOptionFor(c, complexity, department);
    if (o && assessedStaffEmployeeId != null && c.staffEmployeeId === assessedStaffEmployeeId) return { ...o, eligible: false, reason: "Cannot sign their own competency" };
    return o;
  }).filter((o): o is SignerOption => !!o);
  return opts.sort((a, b) =>
    (a.eligible === b.eligible ? 0 : a.eligible ? -1 : 1)
    || (ROLE_ORDER[a.role || ""] ?? 3) - (ROLE_ORDER[b.role || ""] ?? 3)
    || a.name.localeCompare(b.name));
}

export type MethodMilestone = "initial" | "six_month" | "first_annual" | "annual";
export const MILESTONE_LABEL: Record<MethodMilestone, string> = {
  initial: "Initial", six_month: "6-month", first_annual: "First annual", annual: "Annual",
};
// The milestones a method can be signed for: waived has no 6-month or first annual (initial, then annual).
export function milestonesForComplexity(complexity: string | null | undefined): MethodMilestone[] {
  return normalizeComplexity(complexity) === "WAIVED" ? ["initial", "annual"] : ["initial", "six_month", "first_annual", "annual"];
}
// The milestone after the last one signed (none signed -> initial).
export function nextMilestoneAfter(last: MethodMilestone | null | undefined, complexity: string | null | undefined): MethodMilestone {
  if (!last) return "initial";
  if (normalizeComplexity(complexity) === "WAIVED") return "annual";
  return last === "initial" ? "six_month" : last === "six_month" ? "first_annual" : "annual";
}

// Initials from a name ("Dr. Morgan Chen" -> "MC").
export function initialsOf(name: string): string {
  return String(name || "").replace(/^(dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join("").slice(0, 4);
}
