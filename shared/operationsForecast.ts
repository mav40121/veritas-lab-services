// shared/operationsForecast.ts
//
// VeritaPace operations leverage chain, grounded in Michael Veri's productivity
// methodology (MedicalLab Management, June 2019, "The Fantasy Medical Center" worked
// example). Productivity = productive hours / billable tests.
//
// The chain: productivity GOAL -> budgeted hour allowance -> FTE budget
//            -> (Phase 3) staffing-model FTE need -> gap -> (Phase 4) capital trade-off.
//
// This module covers the second link (forecastFromGoal) plus the downstream gap math
// the report and staffing model consume. Verified against the paper's published FMC
// figures in scripts/verify-forecast-from-goal.js.

export const DEFAULT_HOURS_PER_FTE_YEAR = 2080; // 40 hr/week x 52 weeks
export const WEEKS_PER_YEAR = 52;

export interface GoalForecastInput {
  /** Target productive-hours-per-billable-test, e.g. 0.12. */
  goalRatio: number;
  /** Forecasted billable tests per year. */
  annualVolume: number;
  /** Paid hours per FTE per year. Defaults to 2080 (40 hr/week x 52). */
  hoursPerFteYear?: number;
}

export interface GoalForecastResult {
  goalRatio: number;
  annualVolume: number;
  hoursPerFteYear: number;
  /** goalRatio x annualVolume. */
  annualHourAllowance: number;
  /** annualHourAllowance / 52. */
  weeklyHourAllowance: number;
  /** annualHourAllowance / hoursPerFteYear. */
  fteBudget: number;
}

/**
 * forecastFromGoal: given a productivity goal and a forecasted volume, derive the
 * budgeted productive-hour allowance and the FTE budget.
 *
 * FMC example: forecastFromGoal({ goalRatio: 0.12, annualVolume: 450000 })
 *   -> annualHourAllowance 54000, weeklyHourAllowance ~1038, fteBudget ~25.96 (paper: 25.9).
 */
export function forecastFromGoal(input: GoalForecastInput): GoalForecastResult {
  const hoursPerFteYear = input.hoursPerFteYear ?? DEFAULT_HOURS_PER_FTE_YEAR;
  const goalRatio = Number(input.goalRatio) || 0;
  const annualVolume = Number(input.annualVolume) || 0;
  const annualHourAllowance = goalRatio * annualVolume;
  const weeklyHourAllowance = annualHourAllowance / WEEKS_PER_YEAR;
  const fteBudget = hoursPerFteYear > 0 ? annualHourAllowance / hoursPerFteYear : 0;
  return { goalRatio, annualVolume, hoursPerFteYear, annualHourAllowance, weeklyHourAllowance, fteBudget };
}

export interface ChainGapInput {
  annualVolume: number;
  /** FTE budget from forecastFromGoal. */
  fteBudget: number;
  /** FTE need from the staffing model (Phase 3). */
  staffingModelFte: number;
  hoursPerFteYear?: number;
}

export interface ChainGapResult {
  /** staffingModelFte - fteBudget. Positive means the model exceeds the budget. */
  fteGap: number;
  /** staffingModelFte x hoursPerFteYear. */
  staffingModelAnnualHours: number;
  /** staffingModelAnnualHours / annualVolume: the productivity the model actually projects. */
  projectedProductivity: number;
}

/**
 * chainGap: given the staffing-model FTE need, the gap vs the budget and the
 * productivity the model actually projects.
 *
 * FMC example: chainGap({ annualVolume: 450000, fteBudget: 25.96, staffingModelFte: 28.3 })
 *   -> staffingModelAnnualHours 58864, projectedProductivity ~0.131 (paper: 0.13).
 */
export function chainGap(input: ChainGapInput): ChainGapResult {
  const hoursPerFteYear = input.hoursPerFteYear ?? DEFAULT_HOURS_PER_FTE_YEAR;
  const staffingModelFte = Number(input.staffingModelFte) || 0;
  const annualVolume = Number(input.annualVolume) || 0;
  const staffingModelAnnualHours = staffingModelFte * hoursPerFteYear;
  const projectedProductivity = annualVolume > 0 ? staffingModelAnnualHours / annualVolume : 0;
  return {
    fteGap: staffingModelFte - (Number(input.fteBudget) || 0),
    staffingModelAnnualHours,
    projectedProductivity,
  };
}

// The staffing model (Phase 3): the shift grid that produces the FTE need fed into
// chainGap. Mirrors the LTSHealth Staff Management Tool "Staffing Grid" sheet: each
// position line is hours/shift x days/week (+ an over-under weekly-hours adjustment),
// summed to weekly hours, divided by weekly hours per FTE (hoursPerFteYear / 52, i.e.
// 40 at 2080). This is coverage-built, so it typically exceeds the demand-driven FTE
// budget; that difference is the gap.

export interface StaffingGridLine {
  hoursPerShift: number;
  daysPerWeek: number;
  /** Manual weekly-hours adjustment (the tool's over/under column). */
  overUnder?: number;
}

export interface StaffingGridResult {
  weeklyHours: number;
  fteNeed: number;
}

/**
 * staffingGridFte: sum the shift grid to weekly hours and convert to an FTE need.
 *
 * LTSHealth example (27 position lines) -> weeklyHours 1481, fteNeed 37.0.
 */
export function staffingGridFte(lines: StaffingGridLine[], hoursPerFteYear = DEFAULT_HOURS_PER_FTE_YEAR): StaffingGridResult {
  const weeklyHoursPerFte = hoursPerFteYear / WEEKS_PER_YEAR; // 40 at 2080
  const weeklyHours = (lines || []).reduce(
    (sum, l) => sum + ((Number(l.hoursPerShift) || 0) * (Number(l.daysPerWeek) || 0) + (Number(l.overUnder) || 0)),
    0,
  );
  const fteNeed = weeklyHoursPerFte > 0 ? weeklyHours / weeklyHoursPerFte : 0;
  return { weeklyHours, fteNeed };
}
