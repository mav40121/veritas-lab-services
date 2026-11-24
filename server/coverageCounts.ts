// server/coverageCounts.ts
//
// VeritaCheck Coverage as a few counts per lab, for Inspection Readiness and its multi-lab roll-up (B2,
// 2026-11-24). The calculation is computeCoverageForLab's own (server/veritacheckCoverage.ts), never a second one: what it
// answers for a lab is kept here as counts plus the dates each requirement is next due.
//
// Why it is kept: working Coverage out took about 58 ms for a lab of 240 map rows and 350 studies, so 150 labs held the
// server for 8.7 seconds (scripts/measure-readiness-150-labs.mts). Keeping each pair of names' match (analyteMatch) and an
// index on veritamap_instrument_tests.map_id took that to 1.7 seconds; keeping the counts takes the whole roll-up for 150
// labs to about 0.9 seconds, 2.4 on the first read after a restart (it was 0.2 with no coverage). Chosen over working it
// out only when a lab's row is opened, because a system leader needs the column for every lab to see which lab to open.
//
// How it stays right: the key is a hash of exactly the rows Coverage reads for the lab (coverageInputsForLab), read again
// on every request. A saved study, an exemption, a menu change or an outside record changes the hash, so the next read
// works it out again; nothing has to remember to clear it and no time limit is involved. The calendar day isn't in the
// key: next-due dates are kept and compared with the lab's today at each read, with the comparison Coverage makes
// (overdue = due before today) and the digest's 30 days for due soon. Memory only; a restart starts empty.
import { createHash } from "node:crypto";
import { computeCoverageForLab, coverageInputsForLab, type CoverageResult } from "./veritacheckCoverage";
import { addLabDays, labToday } from "./dateLocal";

export interface CoverageCounts {
  hasMap: boolean;
  required: number; // calibration verification / linearity rows that aren't exempt, plus method comparisons needed
  missing: number;  // owed with no due date: nothing on file, failed, or not signed
  review: number;   // a study is on file for the test, but not for this analyzer
  overdue: number;  // last signed study's next-due date has passed
  dueSoon: number;  // next due within 30 days
}

type Kept = { key: string; hasMap: boolean; required: number; missing: number; review: number; dueDates: Map<string, number> };

/** What a lab's coverage holds that doesn't depend on today: undated counts, and how many requirements fall due on each date. */
export function keptFromCoverage(cov: CoverageResult): Omit<Kept, "key"> {
  let required = 0, missing = 0, review = 0;
  const dueDates = new Map<string, number>();
  const due = (d: string) => dueDates.set(d, (dueDates.get(d) || 0) + 1);
  for (const r of cov.rows) {
    if (r.linearityStatus === "exempt") continue;
    required++;
    if (r.nextDueOn) due(r.nextDueOn);
    else if (r.linearityStatus === "review") review++;
    else if (r.linearityStatus === "missing") missing++;
    // else covered with no date recorded (a signed study from before dates were kept): satisfied, nothing to count down to.
  }
  for (const m of cov.methodComparisons) {
    required++;
    if (m.nextDueOn) due(m.nextDueOn);
    else missing++;
  }
  return { hasMap: cov.hasMap, required, missing, review, dueDates };
}

const KEEP_LABS = 5000;
const keptByDb = new WeakMap<object, Map<number, Kept>>();

/** One lab's Coverage counts as of the lab's today (the request's lab clock; a caller with none runs it in withLabClock). */
export function coverageCountsForLab(sqlite: any, labId: number): CoverageCounts {
  let labs = keptByDb.get(sqlite);
  if (!labs) { labs = new Map(); keptByDb.set(sqlite, labs); }
  const key = createHash("sha1").update(JSON.stringify(coverageInputsForLab(sqlite, labId))).digest("base64");
  let kept = labs.get(labId);
  if (!kept || kept.key !== key) {
    kept = { key, ...keptFromCoverage(computeCoverageForLab(sqlite, labId)) };
    if (labs.size >= KEEP_LABS && !labs.has(labId)) labs.delete(labs.keys().next().value as number);
    labs.set(labId, kept);
  }
  const today = labToday(), soon = addLabDays(today, 30);
  let overdue = 0, dueSoon = 0;
  for (const [d, n] of kept.dueDates) { if (d < today) overdue += n; else if (d <= soon) dueSoon += n; }
  return { hasMap: kept.hasMap, required: kept.required, missing: kept.missing, review: kept.review, overdue, dueSoon };
}
