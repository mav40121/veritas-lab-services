// server/verdictRuleHold.ts
//
// Saved VeritaCheck rows whose stored verdict a corrected rule could change. The boot recompute
// (recomputeAllStudyStatuses) leaves them as saved, the way isUnitsRuleStudy holds the units-criterion rows, until
// Michael has the counts from GET /api/admin/veritacheck/lot-abnormal-refrange-counts and decides. A re-save (Run
// Study, Save Changes) judges a row by the current rule, as for any study.
//
//   lot_to_lot_one_cohort (BUG-157, 2026-11-10): a Normal Only or Abnormal Only study (or one with no sample type,
//     which reads as Abnormal Only) holding a complete pair labeled other than its cohort. The Abnormal Only form saved
//     its pairs labeled Normal, so the old rule counted none of them; the rule now counts them (shared/lotToLotCohort.ts).

import { lotCohortRuleChanges } from "@shared/lotToLotCohort";

export type VerdictRuleHold = "lot_to_lot_one_cohort";

type StudyLike = { studyType?: string; study_type?: string; dataPoints?: string | null; data_points?: string | null };

function parsed(study: StudyLike): unknown {
  try { return JSON.parse(study.dataPoints ?? study.data_points ?? "null"); } catch { return null; }
}

export function heldForVerdictRuleDecision(study: StudyLike): VerdictRuleHold | null {
  const type = study.studyType ?? study.study_type;
  if (type === "lot_to_lot") return lotCohortRuleChanges(parsed(study)) ? "lot_to_lot_one_cohort" : null;
  return null;
}
