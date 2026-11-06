// shared/competencyClearance.ts
//
// Which competency records can stand behind a person testing patients. 42 CFR 493.1445(e)(12) and 493.1407(e)(11) have personnel demonstrate
// they can perform the testing before they test patients' specimens, and 493.1451(b)(9) and 493.1413(b)(9) have them reevaluated before reporting
// when methodology or instrumentation changes. A technical or waived competency speaks to that. A non-technical competency or a new-hire evaluation
// (both type "nontechnical") doesn't, so it never clears anyone in VeritaStaff, starts a technical clock or closes a method's reevaluation.
//
// An allowlist, so a type added later clears nobody until someone decides it should. Read the program's type, never competency_assessments.competency_type:
// rows from before 2026-11-06 hold 'technical' from Bulk Import and Cohort Sign-off whatever their program was. Queries that can't call this write
// the same two types out: p.type IN ('technical', 'waived').

export const CLEARANCE_PROGRAM_TYPES = ["technical", "waived"] as const;

export const programCanClearForTesting = (programType: unknown): boolean =>
  (CLEARANCE_PROGRAM_TYPES as readonly unknown[]).includes(programType);
