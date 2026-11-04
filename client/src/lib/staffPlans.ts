// Plans that include VeritaStaff. Explicit allowlist, the same one the server checks (hasStaffAccess in server/routes.ts).
const STAFF_PLANS = ["annual", "professional", "lab", "complete", "veritamap", "veritascan", "veritacomp", "clinic", "waived", "community", "hospital", "large_hospital", "enterprise"];

export function hasStaffPlan(plan: string | null | undefined): boolean {
  return !!plan && STAFF_PLANS.includes(plan);
}
