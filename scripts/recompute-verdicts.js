#!/usr/bin/env node
/**
 * One-time re-evaluation: recompute stored verdicts using the §493 dual-criterion TEa rule.
 *
 * For every study with clia_absolute_floor set, recomputes the pass/fail verdict
 * using the dual-criterion logic: pass when |diff| <= max(pct_allowance, absolute_floor).
 *
 * Usage:
 *   node scripts/recompute-verdicts.js [--dry-run]
 *
 * With --dry-run, prints what would change without writing to DB.
 */

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dryRun = process.argv.includes("--dry-run");

const FP_EPS = 1e-9;

function safeJsonParse(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

function computeStudyStatus(studyType, dataPointsJson, instrumentsJson, cliaAllowableError, teaIsPercentage, cliaAbsoluteFloor) {
  const rawData = safeJsonParse(dataPointsJson, null);
  const instrumentNames = safeJsonParse(instrumentsJson, []);
  if (!rawData) return "fail";

  if (studyType === "cal_ver") {
    const dataPoints = rawData;
    const valid = dataPoints.filter(dp => dp.expectedValue !== null && instrumentNames.some(n => dp.instrumentValues[n] !== null));
    let passCount = 0, totalCount = 0;
    for (const dp of valid) {
      const assigned = dp.expectedValue;
      for (const n of instrumentNames) {
        const v = dp.instrumentValues[n];
        if (v !== null && v !== undefined) {
          totalCount++;
          const obsError = assigned !== 0 ? (v - assigned) / assigned : 0;
          if (Math.abs(obsError) <= cliaAllowableError) passCount++;
        }
      }
    }
    return (passCount === totalCount && totalCount > 0) ? "pass" : "fail";
  }

  if (studyType === "method_comparison") {
    if (rawData.assayType === "qualitative") {
      const { passThreshold, points } = rawData;
      const comparisonNames = instrumentNames.slice(1);
      const compName = comparisonNames[0];
      if (!points || !compName) return "fail";
      let agree = 0, total = 0;
      for (const dp of points) {
        const ref = dp.expectedCategory;
        const comp = dp.instrumentCategories?.[compName];
        if (ref && comp) { total++; if (ref === comp) agree++; }
      }
      return (total > 0 ? agree / total : 0) >= (passThreshold || 0.90) ? "pass" : "fail";
    }
    if (rawData.assayType === "semi_quantitative") {
      const { gradeScale, passThreshold, points } = rawData;
      const comparisonNames = instrumentNames.slice(1);
      const compName = comparisonNames[0];
      if (!points || !compName || !gradeScale) return "fail";
      const gradeIndex = {};
      gradeScale.forEach((g, i) => { gradeIndex[g] = i; });
      let withinOne = 0, total = 0;
      for (const dp of points) {
        const ref = dp.expectedCategory;
        const comp = dp.instrumentCategories?.[compName];
        if (ref && comp && gradeIndex[ref] !== undefined && gradeIndex[comp] !== undefined) {
          total++;
          if (Math.abs(gradeIndex[ref] - gradeIndex[comp]) <= 1) withinOne++;
        }
      }
      return (total > 0 ? withinOne / total : 0) >= (passThreshold || 0.80) ? "pass" : "fail";
    }

    // Standard quantitative method comparison
    const dataPoints = rawData;
    const primaryName = instrumentNames[0];
    const hasAllInValues = dataPoints.length > 0 && instrumentNames.every(n => n in (dataPoints[0].instrumentValues || {}));
    let comparisonNames;
    let mappedPoints;
    if (hasAllInValues && instrumentNames.length >= 2) {
      comparisonNames = instrumentNames.slice(1);
      mappedPoints = dataPoints.map(d => ({
        level: d.level,
        expectedValue: d.instrumentValues[primaryName] ?? null,
        instrumentValues: Object.fromEntries(comparisonNames.map(n => [n, d.instrumentValues[n] ?? null])),
      }));
    } else {
      comparisonNames = instrumentNames.filter(n => n in (dataPoints[0]?.instrumentValues || {}));
      if (comparisonNames.length === 0) comparisonNames = instrumentNames;
      mappedPoints = dataPoints;
    }

    const valid = mappedPoints.filter(dp => dp.expectedValue !== null && comparisonNames.some(n => dp.instrumentValues[n] !== null));
    let passCount = 0, totalCount = 0;
    const biasVals = [];
    for (const dp of valid) {
      const ref = dp.expectedValue;
      for (const n of comparisonNames) {
        const v = dp.instrumentValues[n];
        if (v !== null && v !== undefined) {
          totalCount++;
          const diff = v - ref;
          // Dual-criterion S493 rule
          const pctAllowance = teaIsPercentage ? Math.abs(ref) * cliaAllowableError : 0;
          const absAllowance = teaIsPercentage ? (cliaAbsoluteFloor ?? 0) : cliaAllowableError;
          const allowance = Math.max(pctAllowance, absAllowance);
          if (teaIsPercentage) {
            biasVals.push(ref !== 0 ? (v - ref) / ref : 0);
          } else {
            biasVals.push(diff);
          }
          if (Math.abs(diff) <= allowance + FP_EPS) passCount++;
        }
      }
    }

    let computedResult = (passCount === totalCount && totalCount > 0) ? "pass" : "fail";
    if (biasVals.length > 0) {
      const meanAbsBias = biasVals.reduce((a, b) => a + Math.abs(b), 0) / biasVals.length;
      let meanAllowance;
      if (teaIsPercentage) {
        const refs = valid.flatMap(dp => {
          const ref = dp.expectedValue;
          return comparisonNames.filter(n => dp.instrumentValues[n] !== null && dp.instrumentValues[n] !== undefined).map(() => ref);
        });
        const meanRef = refs.length > 0 ? refs.reduce((a, b) => a + Math.abs(b), 0) / refs.length : 0;
        const absFloorAsFraction = (cliaAbsoluteFloor ?? 0) / (meanRef || 1);
        meanAllowance = Math.max(cliaAllowableError, absFloorAsFraction);
      } else {
        meanAllowance = cliaAllowableError;
      }
      if (meanAbsBias > meanAllowance + FP_EPS && computedResult === "pass") {
        computedResult = "fail";
      }
    }
    return computedResult;
  }

  if (studyType === "precision") {
    const dataPoints = rawData;
    const allowableCV = cliaAllowableError * 100;
    let passCount = 0, totalCount = 0;
    for (const dp of dataPoints) {
      const allVals = dp.days ? dp.days.flat().filter(v => v !== null && !isNaN(v)) : dp.values.filter(v => v !== null && !isNaN(v));
      if (allVals.length < 2) { totalCount++; continue; }
      totalCount++;
      const mean = allVals.reduce((a, b) => a + b, 0) / allVals.length;
      const variance = allVals.reduce((a, b) => a + (b - mean) ** 2, 0) / (allVals.length - 1);
      const cv = mean !== 0 ? (Math.sqrt(variance) / Math.abs(mean)) * 100 : 0;
      if (cv <= allowableCV) passCount++;
    }
    return (passCount === totalCount && totalCount > 0) ? "pass" : "fail";
  }

  return "fail";
}

// Main
const dbPath = path.resolve(__dirname, "..", "veritas.db");
console.log(`Opening database: ${dbPath}`);
console.log(`Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);

const db = new Database(dbPath);

const studies = db.prepare("SELECT id, test_name, study_type, data_points, instruments, clia_allowable_error, tea_is_percentage, status, result, clia_absolute_floor FROM studies").all();
const update = db.prepare("UPDATE studies SET status = ?, result = ? WHERE id = ?");

let changed = 0;
let unchanged = 0;

for (const study of studies) {
  const teaIsPercentage = study.tea_is_percentage !== 0;
  const computed = computeStudyStatus(
    study.study_type,
    study.data_points,
    study.instruments,
    study.clia_allowable_error,
    teaIsPercentage,
    study.clia_absolute_floor ?? null
  );

  const currentResult = study.result || study.status;
  if (computed !== currentResult) {
    if (dryRun) {
      console.log(`  [dry-run] study #${study.id} "${study.test_name}": ${currentResult} -> ${computed}`);
    } else {
      update.run(computed, computed, study.id);
      console.log(`  study #${study.id} "${study.test_name}": ${currentResult} -> ${computed}`);
    }
    changed++;
  } else {
    unchanged++;
  }
}

console.log(`\nDone. Changed: ${changed}, Unchanged: ${unchanged}`);
db.close();
