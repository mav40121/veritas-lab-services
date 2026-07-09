// server/teaAllowance.ts
//
// Single source of truth for the dual-criterion CLIA total-allowable-error
// envelope at a given concentration. This mirrors, byte-for-byte, the
// per-instrument allowance computeStudyStatus() applies for the authoritative
// pass/fail verdict (server/routes.ts, cal_ver at lines ~193-195 and
// method_comparison at ~478-479):
//
//   pctAllowance = teaIsPercentage ? |base| * cliaAllowableError : 0
//   absAllowance = teaIsPercentage ? (cliaAbsoluteFloor ?? 0) : cliaAllowableError
//   allowance    = max(pctAllowance, absAllowance)
//
// Semantics:
//   - When tea_is_percentage != 0 (the column default is 1), cliaAllowableError
//     is a FRACTION (e.g. 0.10 == 10%). The envelope is |base| * fraction, but
//     never tighter than the absolute floor (clia_absolute_floor), which
//     protects low-concentration levels where a percent band collapses to ~0.
//   - When tea_is_percentage == 0, cliaAllowableError is itself an ABSOLUTE
//     value in the analyte's units, applied flat at every concentration; the
//     percent term and the floor do not apply.
//
// The verification PDF's statistical appendix (renderStudyAppendix) must use
// THIS function so the appendix table can never assert a different verdict than
// the headline computeStudyStatus result. Before this helper the appendix
// computed a percent-only, mean-based band that silently ignored both
// tea_is_percentage and clia_absolute_floor.
//
// Convention for deriving teaIsPercentage from a row: `tea_is_percentage != 0`
// (percent unless explicitly 0). See routes.ts call sites (e.g. line 574) and
// pdfReport.ts:486.
//
// TODO(follow-up): have computeStudyStatus import this helper at its cal_ver /
// method_comparison / ref_interval / lot_to_lot call sites so the authoritative
// path and the appendix are literally the same code, not two copies of the same
// formula. Deferred out of this PR to keep the verdict path untouched.

export function teaAllowanceAt(
  base: number,
  cliaAllowableError: number,
  teaIsPercentage: boolean,
  cliaAbsoluteFloor: number | null | undefined,
): number {
  const pctAllowance = teaIsPercentage ? Math.abs(base) * cliaAllowableError : 0;
  const absAllowance = teaIsPercentage ? (cliaAbsoluteFloor ?? 0) : cliaAllowableError;
  return Math.max(pctAllowance, absAllowance);
}
