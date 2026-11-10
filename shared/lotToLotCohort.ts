// shared/lotToLotCohort.ts
//
// Which saved pairs a reagent lot verification (lot-to-lot, CLSI EP26) cohort counts. One rule for the results page
// (client/src/lib/calculations.ts calculateLotToLot), the stored verdict (server/routes.ts computeStudyStatus) and the
// demo PDF route, so they cannot drift. Relative imports only: the server bundles the client lib that uses it.
//
// BUG-157 (2026-11-10, found while fixing BUG-146): the Abnormal Only form types its pairs into the one Specimen Data
// grid, whose rows carry cohort "Normal", while the Abnormal Only study counted only rows labeled "Abnormal". Every
// Abnormal Only study read N = 0 and FAIL on the results page, in the stored verdict and in the PDF. A study with one
// cohort (Normal Only, Abnormal Only, or no sample type saved, which reads as Abnormal Only) now counts every complete
// pair it holds; only a Both study splits its pairs by their cohort label. The form now also labels them Abnormal.

export type LotCohort = "Normal" | "Abnormal";

// The cohorts a study reports, by its saved sample type (unchanged: anything but "both" or "normal" reads as Abnormal).
export function lotCohortsFor(sampleType: unknown): LotCohort[] {
  return sampleType === "both" ? ["Normal", "Abnormal"] : [sampleType === "normal" ? "Normal" : "Abnormal"];
}

// Whether a saved pair, labeled pairCohort, belongs to cohort in a study of this sample type.
export function pairInCohort(pairCohort: unknown, cohort: LotCohort, sampleType: unknown): boolean {
  return sampleType === "both" ? pairCohort === cohort : true;
}

// True when this rule and the one before BUG-157 pick different pairs for this saved data: a one-cohort study holding a
// complete pair (the stored verdict's test: currentLot and newLot not null) labeled other than its cohort. Only these
// rows can get a different verdict from the fix; the boot recompute leaves them as saved until Michael decides.
export function lotCohortRuleChanges(dataPoints: unknown): boolean {
  if (!dataPoints || typeof dataPoints !== "object" || Array.isArray(dataPoints)) return false;
  const { data, sampleType } = dataPoints as { data?: unknown; sampleType?: unknown };
  if (sampleType === "both" || !Array.isArray(data)) return false;
  const [cohort] = lotCohortsFor(sampleType);
  return data.some((dp: any) => dp && dp.currentLot !== null && dp.newLot !== null && dp.cohort !== cohort);
}
