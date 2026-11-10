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
//   ref_interval (BUG-155, 2026-11-10): a reference range study the old stored reading and the results page's
//     calculator could judge differently. They agree, provably, on a row of 20 or more specimens whose every value is
//     a plain number, none excluded, with both limits numbers (scripts/verify-veritacheck-lot-refrange.mjs checks the
//     two pass tests agree for every count up to 1,000 specimens). Any other row is held: a blank or censored value, fewer
//     than 20 specimens, an exclusion flag, or a limit that isn't a number.

import { lotCohortRuleChanges } from "@shared/lotToLotCohort";
import { isCensored, type CensoringPolicy } from "@shared/censoring";
import { calculateRefInterval } from "../client/src/lib/calculations";
import { deepResolveCensored } from "../client/src/lib/studyResults";

export type VerdictRuleHold = "lot_to_lot_one_cohort" | "ref_interval";

type StudyLike = { studyType?: string; study_type?: string; dataPoints?: string | null; data_points?: string | null };

function parsed(study: StudyLike): unknown {
  try { return JSON.parse(study.dataPoints ?? study.data_points ?? "null"); } catch { return null; }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// True unless the row is one the old and new reference range readings provably judge the same way.
export function refIntervalRuleChanges(dataPoints: unknown): boolean {
  if (!dataPoints || typeof dataPoints !== "object" || Array.isArray(dataPoints)) return false;
  const { specimens, refLow, refHigh } = dataPoints as { specimens?: unknown; refLow?: unknown; refHigh?: unknown };
  if (!Array.isArray(specimens)) return false;
  if (specimens.length < 20 || !isNum(refLow) || !isNum(refHigh)) return true;
  return specimens.some((s: any) => !s || typeof s !== "object" || s.excluded || !isNum(s.value));
}

// Why a held reference range row is held, for the counts read (a row can have more than one reason).
export function refIntervalHoldReasons(dataPoints: unknown, policy: CensoringPolicy) {
  const dp = (dataPoints && typeof dataPoints === "object" && !Array.isArray(dataPoints) ? dataPoints : {}) as any;
  const specimens: any[] = Array.isArray(dp.specimens) ? dp.specimens : [];
  const values = specimens.map((s) => (s && typeof s === "object" ? s.value : undefined));
  let results = -1;
  try { results = calculateRefInterval(deepResolveCensored(specimens, policy), dp.refLow, dp.refHigh, "", "").n; } catch { /* unreadable */ }
  return {
    blank: values.some((v) => v === null || v === undefined || v === ""),
    censored: values.some((v) => isCensored(v)),
    fewerThan20Results: results >= 0 && results < 20,
    other: specimens.some((s) => s && typeof s === "object" && s.excluded) || !isNum(dp.refLow) || !isNum(dp.refHigh)
      || values.some((v) => v !== null && v !== undefined && v !== "" && !isCensored(v) && !isNum(v)),
  };
}

export function heldForVerdictRuleDecision(study: StudyLike): VerdictRuleHold | null {
  const type = study.studyType ?? study.study_type;
  if (type === "lot_to_lot") return lotCohortRuleChanges(parsed(study)) ? "lot_to_lot_one_cohort" : null;
  if (type === "ref_interval") return refIntervalRuleChanges(parsed(study)) ? "ref_interval" : null;
  return null;
}
