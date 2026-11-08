// shared/heparinRange.ts
//
// Heparin Therapeutic Range, aPTT vs Anti-Xa (Brill-Edwards) study (REQ-124, Lisa Veri / Milford, 2026-11-02;
// Michael Q134 = 1). One evaluator for the entry form, the results page, the server verdict and the PDF, so they
// cannot disagree. The method as Marlar, Clement and Gausman describe it (Semin Thromb Hemost 2017;43:253-260,
// Table 2; Marlar and Gausman, Arch Pathol Lab Med 2013;137:77-82): at least 20 ex vivo samples from patients on
// unfractionated heparin, fewer than 10% from any one patient, no sample with an INR above 1.5; aPTT (y) regressed on
// anti-Xa (x) by ordinary least squares; the therapeutic range is the aPTT at the anti-Xa targets (0.3 and 0.7 IU/mL).
//
// The verdict is whether the SAMPLE SET meets those criteria (Michael Q134 = 1). CLIA total allowable error does not
// apply here, and no source sets a minimum correlation, so r is reported and never gates the result.
// No PHI: patient codes are de-identified by the laboratory.

export interface HeparinRangeSample {
  id: string;
  patientCode: string;
  antiXa: number | null;     // IU/mL
  aptt: number | null;       // seconds
  inr: number | null;
  plasma: "fresh" | "frozen";
  exclude: boolean;
  excludeReason: string;
}

export interface HeparinRangeInput {
  reagentLot: string;
  reagentExp?: string;
  antiXaMethod: string;
  antiXaLot?: string;
  targetLow: number;          // anti-Xa IU/mL, default 0.3
  targetHigh: number;         // anti-Xa IU/mL, default 0.7
  priorLot?: string;
  priorLow?: number | null;   // seconds, the lot in use
  priorHigh?: number | null;
  samples: HeparinRangeSample[];
}

export interface HeparinRangeCriterion { key: string; label: string; value: string; met: boolean }

export interface HeparinRangeResult {
  studyKind: "heparin_range";
  n: number;                  // included samples with both values
  entered: number;            // samples with both values, included or not
  excludedCount: number;
  slope: number | null;
  intercept: number | null;
  r: number | null;
  r2: number | null;
  see: number | null;
  rangeLow: number | null;    // aPTT seconds at targetLow, unrounded
  rangeHigh: number | null;
  rangeLowRounded: number | null;   // whole seconds, as reported
  rangeHighRounded: number | null;
  targetLow: number;
  targetHigh: number;
  maxPatientCount: number;
  maxPatientPct: number;
  inrAboveLimit: number;      // included samples with INR above 1.5
  inrMissing: number;         // included samples with no INR entered
  criteria: HeparinRangeCriterion[];
  meets: boolean;
  overallPass: boolean;       // = meets; the name the study status code reads
  summary: string;
  rows: Array<HeparinRangeSample & { included: boolean; residual: number | null; flags: string[] }>;
}

export const HEPARIN_MIN_SAMPLES = 20;
export const HEPARIN_MAX_PATIENT_PCT = 10;   // fewer than 10% of samples from one patient
export const HEPARIN_INR_LIMIT = 1.5;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeHeparinInput(raw: any): HeparinRangeInput {
  const r = raw && typeof raw === "object" ? raw : {};
  const tl = num(r.targetLow), th = num(r.targetHigh);
  return {
    reagentLot: String(r.reagentLot ?? "").trim(),
    reagentExp: String(r.reagentExp ?? "").trim(),
    antiXaMethod: String(r.antiXaMethod ?? "").trim(),
    antiXaLot: String(r.antiXaLot ?? "").trim(),
    targetLow: tl ?? 0.3,
    targetHigh: th ?? 0.7,
    priorLot: String(r.priorLot ?? "").trim(),
    priorLow: num(r.priorLow),
    priorHigh: num(r.priorHigh),
    samples: (Array.isArray(r.samples) ? r.samples : []).map((s: any, i: number) => ({
      id: String(s?.id ?? "").trim() || `S-${String(i + 1).padStart(2, "0")}`,
      patientCode: String(s?.patientCode ?? "").trim(),
      antiXa: num(s?.antiXa),
      aptt: num(s?.aptt),
      inr: num(s?.inr),
      plasma: s?.plasma === "frozen" ? "frozen" : "fresh",
      exclude: !!s?.exclude,
      excludeReason: String(s?.excludeReason ?? "").trim(),
    })),
  };
}

export function evaluateHeparinRange(raw: any): HeparinRangeResult {
  const input = normalizeHeparinInput(raw);
  const withValues = input.samples.filter((s) => s.antiXa !== null && s.aptt !== null);
  const inc = withValues.filter((s) => !s.exclude);
  const excluded = input.samples.filter((s) => s.exclude);
  const n = inc.length;

  let slope: number | null = null, intercept: number | null = null, r: number | null = null, see: number | null = null;
  if (n >= 3) {
    const mx = inc.reduce((a, s) => a + (s.antiXa as number), 0) / n;
    const my = inc.reduce((a, s) => a + (s.aptt as number), 0) / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (const s of inc) {
      const dx = (s.antiXa as number) - mx, dy = (s.aptt as number) - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (sxx > 0) {
      slope = sxy / sxx;
      intercept = my - slope * mx;
      r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
      const sse = inc.reduce((a, s) => a + ((s.aptt as number) - ((intercept as number) + (slope as number) * (s.antiXa as number))) ** 2, 0);
      see = n > 2 ? Math.sqrt(sse / (n - 2)) : null;
    }
  }
  const rangeLow = slope !== null && intercept !== null ? intercept + slope * input.targetLow : null;
  const rangeHigh = slope !== null && intercept !== null ? intercept + slope * input.targetHigh : null;

  const byPatient = new Map<string, number>();
  for (const s of inc) {
    const k = s.patientCode.toUpperCase() || "(no patient code)";
    byPatient.set(k, (byPatient.get(k) || 0) + 1);
  }
  const maxPatientCount = byPatient.size ? Math.max(...Array.from(byPatient.values())) : 0;
  const maxPatientPct = n ? (100 * maxPatientCount) / n : 0;
  const inrAboveLimit = inc.filter((s) => s.inr !== null && s.inr > HEPARIN_INR_LIMIT).length;
  const inrMissing = inc.filter((s) => s.inr === null).length;
  const unexplained = excluded.filter((s) => !s.excludeReason).length;
  const rises = slope !== null && slope > 0;

  const criteria: HeparinRangeCriterion[] = [
    { key: "n", label: "Samples from patients on unfractionated heparin", value: `${n} included (minimum ${HEPARIN_MIN_SAMPLES})`, met: n >= HEPARIN_MIN_SAMPLES },
    { key: "patient", label: "Most samples from any one patient", value: n ? `${maxPatientCount} of ${n} (${maxPatientPct.toFixed(1)}%; limit under ${HEPARIN_MAX_PATIENT_PCT}%)` : "none", met: n > 0 && maxPatientPct < HEPARIN_MAX_PATIENT_PCT },
    { key: "inr", label: `Included samples with INR above ${HEPARIN_INR_LIMIT}`, value: `${inrAboveLimit}${inrMissing ? ` (INR not entered for ${inrMissing})` : ""}`, met: inrAboveLimit === 0 },
    { key: "excluded", label: "Excluded samples each have a reason", value: `${excluded.length} excluded${unexplained ? `, ${unexplained} without a reason` : ""}`, met: unexplained === 0 },
    { key: "slope", label: "aPTT rises with anti-Xa (positive slope)", value: slope === null ? "not calculated" : `${slope.toFixed(1)} s per IU/mL`, met: rises },
  ];
  const meets = criteria.every((c) => c.met);

  const rows = input.samples.map((s) => {
    const included = !s.exclude && s.antiXa !== null && s.aptt !== null;
    const flags: string[] = [];
    if (s.antiXa !== null && (s.antiXa < 0.1 || s.antiXa > 1.0)) flags.push("anti-Xa outside 0.1 to 1.0 IU/mL");
    if (s.inr !== null && s.inr > 1.3 && s.inr <= HEPARIN_INR_LIMIT) flags.push("INR above 1.3");
    if (s.inr === null && included) flags.push("INR not entered");
    const residual = included && slope !== null && intercept !== null ? (s.aptt as number) - (intercept + slope * (s.antiXa as number)) : null;
    return { ...s, included, residual, flags };
  });

  const rLo = rangeLow === null ? null : Math.round(rangeLow), rHi = rangeHigh === null ? null : Math.round(rangeHigh);
  const summary = meets
    ? `The sample set meets the study criteria. aPTT at ${input.targetLow} to ${input.targetHigh} IU/mL anti-Xa: ${rLo} to ${rHi} seconds.`
    : `The sample set does not meet the study criteria: ${criteria.filter((c) => !c.met).map((c) => c.label.toLowerCase()).join("; ")}.`;

  return {
    studyKind: "heparin_range", n, entered: withValues.length, excludedCount: excluded.length,
    slope, intercept, r, r2: r === null ? null : r * r, see, rangeLow, rangeHigh, rangeLowRounded: rLo, rangeHighRounded: rHi,
    targetLow: input.targetLow, targetHigh: input.targetHigh, maxPatientCount, maxPatientPct, inrAboveLimit, inrMissing,
    criteria, meets, overallPass: meets, summary, rows,
  };
}

// The determination sentence for the PDF and the results page. PASS and FAIL share one structure; only "meets" and
// "does not meet" change (CLAUDE.md section 5), and a FAIL never tells the director what to do.
export function heparinRangeNarrative(res: HeparinRangeResult, reagentLot: string, instrument: string): { determination: string; detail: string } {
  const determination = `The sample set ${res.meets ? "meets" : "does not meet"} the study criteria for an aPTT heparin therapeutic range.`;
  const unmet = res.criteria.filter((c) => !c.met).map((c) => `${c.label.toLowerCase()} (${c.value})`);
  const range = res.rangeLowRounded !== null && res.rangeHighRounded !== null
    ? ` By linear regression of aPTT on anti-Xa, the aPTT corresponding to ${res.targetLow} to ${res.targetHigh} IU/mL anti-Xa with aPTT reagent lot ${reagentLot || "(not entered)"} on ${instrument || "this instrument"} is ${res.rangeLowRounded} to ${res.rangeHighRounded} seconds.`
    : "";
  const detail = `${res.n} samples from patients receiving unfractionated heparin were included.${unmet.length ? ` Criteria not met: ${unmet.join("; ")}.` : " No patient contributed 10% or more of the samples, and no included sample had an INR above 1.5."}${range} Final approval and clinical determination must be made by the laboratory director or designee.`;
  return { determination, detail };
}

// Inline SVG scatter with the fitted line and guides at the two anti-Xa targets. Numbers only (no user text), so the
// same string renders in the browser and in the PDF. Filled points are included; open red points are excluded.
export function heparinRangeChartSVG(res: HeparinRangeResult, width = 330, height = 230): string {
  const pts = res.rows.filter((s) => s.antiXa !== null && s.aptt !== null) as Array<HeparinRangeResult["rows"][number] & { antiXa: number; aptt: number }>;
  const ys = pts.map((s) => s.aptt).concat(res.rangeLow ?? [], res.rangeHigh ?? []);
  const yMin = Math.max(0, Math.floor((Math.min(...(ys.length ? ys : [30])) - 10) / 10) * 10);
  const yMax = Math.ceil((Math.max(...(ys.length ? ys : [120])) + 10) / 10) * 10;
  const xMax = Math.max(1.0, ...pts.map((s) => Math.ceil(s.antiXa * 10) / 10));
  const L = 40, B = 30, T = 10, R = 10;
  const X = (v: number) => L + (v / xMax) * (width - L - R);
  const Y = (v: number) => height - B - ((v - yMin) / (yMax - yMin || 1)) * (height - B - T);
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += Math.max(10, Math.round((yMax - yMin) / 50) * 10)) yTicks.push(v);
  const xTicks = Array.from({ length: Math.round(xMax / 0.2) + 1 }, (_, i) => +(i * 0.2).toFixed(1));
  const grid = yTicks.map((v) => `<line x1="${L}" x2="${width - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="#eceff2"/><text x="${L - 4}" y="${(Y(v) + 3).toFixed(1)}" font-size="7" text-anchor="end" fill="#646e78">${v}</text>`).join("")
    + xTicks.map((v) => `<text x="${X(v).toFixed(1)}" y="${height - B + 11}" font-size="7" text-anchor="middle" fill="#646e78">${v.toFixed(1)}</text>`).join("");
  const guide = (xv: number, yv: number | null) => yv === null ? "" : `<line x1="${X(xv).toFixed(1)}" x2="${X(xv).toFixed(1)}" y1="${height - B}" y2="${Y(yv).toFixed(1)}" stroke="#964219" stroke-dasharray="3,2"/><line x1="${L}" x2="${X(xv).toFixed(1)}" y1="${Y(yv).toFixed(1)}" y2="${Y(yv).toFixed(1)}" stroke="#964219" stroke-dasharray="3,2"/><text x="${L + 3}" y="${(Y(yv) - 3).toFixed(1)}" font-size="7" fill="#964219">${Math.round(yv)} s</text>`;
  const line = res.slope !== null && res.intercept !== null
    ? `<line x1="${X(0).toFixed(1)}" y1="${Y(res.intercept).toFixed(1)}" x2="${X(xMax).toFixed(1)}" y2="${Y(res.intercept + res.slope * xMax).toFixed(1)}" stroke="#14141e" stroke-width="1.2"/>` : "";
  const dots = pts.map((s) => `<circle cx="${X(s.antiXa).toFixed(1)}" cy="${Y(s.aptt).toFixed(1)}" r="3" fill="${s.included ? "#0e8a82" : "none"}" stroke="${s.included ? "#0e8a82" : "#c8323c"}" stroke-width="1.2"/>`).join("");
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="aPTT versus anti-Xa scatter with regression line">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#fff" rx="4"/>
  <rect x="${L}" y="${T}" width="${width - L - R}" height="${height - B - T}" fill="#fff" stroke="#d2d7dc"/>${grid}<clipPath id="hr-clip"><rect x="${L}" y="${T}" width="${width - L - R}" height="${height - B - T}"/></clipPath><g clip-path="url(#hr-clip)">${line}</g>${guide(res.targetLow, res.rangeLow)}${guide(res.targetHigh, res.rangeHigh)}${dots}
  <text x="${(L + width - R) / 2}" y="${height - 4}" font-size="7.5" text-anchor="middle" fill="#14141e">Anti-Xa (IU/mL)</text>
  <text x="10" y="${(T + height - B) / 2}" font-size="7.5" text-anchor="middle" fill="#14141e" transform="rotate(-90 10 ${(T + height - B) / 2})">aPTT (seconds)</text>
</svg>`;
}
