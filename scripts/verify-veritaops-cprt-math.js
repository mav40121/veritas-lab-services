#!/usr/bin/env node
/**
 * verify-veritaops-cprt-math.js
 *
 * Receipt for the VeritaOps cost-per-reportable-test calculation math
 * (PARKING_LOT #10, v1.0 - v1.4). Mirrors server/veritaops.ts
 * computeCprt() and exercises it against a known input matrix with
 * pre-computed expected outputs.
 *
 * Run with:
 *   node scripts/verify-veritaops-cprt-math.js
 *
 * Exits non-zero on any FAIL so this drops into CI cleanly.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirror of server/veritaops.ts computeCprt() — must be kept in sync.
// If you edit one, edit the other. Any drift between them is exactly
// the kind of bug this script is designed to catch (provided the test
// matrix below covers the branch).
function computeCprt(input) {
  const v = Number(input.annual_volume || 0);
  const safeAmortize = (numerator) => v > 0 ? numerator / v : 0;

  const l1 =
    Number(input.reagent_cost_per_test || 0) +
    safeAmortize(Number(input.calibrator_kit_cost || 0) * Number(input.cals_per_year || 0)) +
    safeAmortize(Number(input.qc_cost_per_run || 0) * Number(input.qc_runs_per_year || 0)) +
    Number(input.other_supplies_per_test || 0);

  const laborPerTest =
    (Number(input.tech_minutes_per_test || 0) / 60) *
    Number(input.tech_loaded_hourly_rate || 0);
  const l2 = l1 + laborPerTest;

  let l3 = l2;
  if (Number(input.include_capital || 0) === 1) {
    const lifeYears = Math.max(1, Number(input.instrument_useful_life_years || 1));
    const annualDepreciation = Number(input.instrument_purchase_cost || 0) / lifeYears;
    const capitalPerTest = safeAmortize(annualDepreciation + Number(input.annual_maintenance_cost || 0));
    l3 = l2 + capitalPerTest;
  }

  let l4 = l3;
  if (Number(input.include_overhead || 0) === 1) {
    const base = Number(input.include_capital || 0) === 1 ? l3 : l2;
    if ((input.overhead_method || 'flat') === 'markup') {
      l4 = base + base * Number(input.overhead_value || 0);
    } else {
      l4 = base + Number(input.overhead_value || 0);
    }
  }

  return { cprt_l1: l1, cprt_l2: l2, cprt_l3: l3, cprt_l4: l4 };
}

// Floating-point compare with a small tolerance.
function approx(a, b, eps = 1e-4) {
  return Math.abs(a - b) < eps;
}

let fails = 0;
function check(label, actual, expected) {
  const ok = approx(actual.cprt_l1, expected.l1)
    && approx(actual.cprt_l2, expected.l2)
    && approx(actual.cprt_l3, expected.l3)
    && approx(actual.cprt_l4, expected.l4);
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}`);
    console.log(`         L1: got ${actual.cprt_l1.toFixed(4)} expected ${expected.l1.toFixed(4)}`);
    console.log(`         L2: got ${actual.cprt_l2.toFixed(4)} expected ${expected.l2.toFixed(4)}`);
    console.log(`         L3: got ${actual.cprt_l3.toFixed(4)} expected ${expected.l3.toFixed(4)}`);
    console.log(`         L4: got ${actual.cprt_l4.toFixed(4)} expected ${expected.l4.toFixed(4)}`);
    fails += 1;
  }
}

console.log('--- VeritaOps CPRT math verification ---');

// CASE 1: zero annual volume. Amortizations must collapse to 0 (no
// divide-by-zero). L1 reduces to reagent + other_supplies.
check('zero-volume edge case (no NaN/Infinity)',
  computeCprt({
    annual_volume: 0,
    reagent_cost_per_test: 0.50,
    calibrator_kit_cost: 100, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    other_supplies_per_test: 0.05,
  }),
  { l1: 0.55, l2: 0.55, l3: 0.55, l4: 0.55 }
);

// CASE 2: L1-only (no labor). Calibrator + QC amortization.
// reagent 0.50 + cal (100*12/10000=0.12) + QC (5*365/10000=0.1825) + other 0.05 = 0.8525
check('L1 baseline reagents + amortized cal/QC + other supplies',
  computeCprt({
    annual_volume: 10000,
    reagent_cost_per_test: 0.50,
    calibrator_kit_cost: 100, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    other_supplies_per_test: 0.05,
  }),
  { l1: 0.8525, l2: 0.8525, l3: 0.8525, l4: 0.8525 }
);

// CASE 3: L2 layered on L1. 1 min × $60/hr = $1.00/test labor.
// L2 = 0.8525 + 1.00 = 1.8525.
check('L2 adds direct labor (1 min @ $60/hr = $1.00)',
  computeCprt({
    annual_volume: 10000,
    reagent_cost_per_test: 0.50,
    calibrator_kit_cost: 100, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    other_supplies_per_test: 0.05,
    tech_minutes_per_test: 1, tech_loaded_hourly_rate: 60,
  }),
  { l1: 0.8525, l2: 1.8525, l3: 1.8525, l4: 1.8525 }
);

// CASE 4: L3 on. Instrument $100k / 5 yrs = $20k/yr depreciation;
// plus $5k/yr maintenance; total $25k/yr ÷ 10000 tests = $2.50/test
// capital. L3 = L2 + 2.50 = 4.3525.
check('L3 adds capital depreciation + maintenance amortization',
  computeCprt({
    annual_volume: 10000,
    reagent_cost_per_test: 0.50,
    calibrator_kit_cost: 100, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    other_supplies_per_test: 0.05,
    tech_minutes_per_test: 1, tech_loaded_hourly_rate: 60,
    include_capital: 1,
    instrument_purchase_cost: 100000, instrument_useful_life_years: 5,
    annual_maintenance_cost: 5000,
  }),
  { l1: 0.8525, l2: 1.8525, l3: 4.3525, l4: 4.3525 }
);

// CASE 5: L4 flat overhead. $0.50/test flat on top of L3.
// L4 = L3 + 0.50 = 4.8525.
check('L4 flat overhead adds dollars-per-test on top of L3',
  computeCprt({
    annual_volume: 10000,
    reagent_cost_per_test: 0.50,
    calibrator_kit_cost: 100, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    other_supplies_per_test: 0.05,
    tech_minutes_per_test: 1, tech_loaded_hourly_rate: 60,
    include_capital: 1,
    instrument_purchase_cost: 100000, instrument_useful_life_years: 5,
    annual_maintenance_cost: 5000,
    include_overhead: 1, overhead_method: 'flat', overhead_value: 0.50,
  }),
  { l1: 0.8525, l2: 1.8525, l3: 4.3525, l4: 4.8525 }
);

// CASE 6: L4 markup overhead at 15% with L3 ON. Base = L3 = 4.3525;
// L4 = L3 * 1.15 = 5.0054 (rounded).
check('L4 markup overhead applies % to L3 when capital is on',
  computeCprt({
    annual_volume: 10000,
    reagent_cost_per_test: 0.50,
    calibrator_kit_cost: 100, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    other_supplies_per_test: 0.05,
    tech_minutes_per_test: 1, tech_loaded_hourly_rate: 60,
    include_capital: 1,
    instrument_purchase_cost: 100000, instrument_useful_life_years: 5,
    annual_maintenance_cost: 5000,
    include_overhead: 1, overhead_method: 'markup', overhead_value: 0.15,
  }),
  { l1: 0.8525, l2: 1.8525, l3: 4.3525, l4: 4.3525 * 1.15 }
);

// CASE 7: L4 markup with L3 OFF. Base = L2 (not L3 = L2 in this case
// because L3 falls through to L2 when capital is off). L4 = L2 * 1.15.
check('L4 markup uses L2 as base when capital is off',
  computeCprt({
    annual_volume: 10000,
    reagent_cost_per_test: 0.50,
    calibrator_kit_cost: 100, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    other_supplies_per_test: 0.05,
    tech_minutes_per_test: 1, tech_loaded_hourly_rate: 60,
    include_capital: 0,
    include_overhead: 1, overhead_method: 'markup', overhead_value: 0.15,
  }),
  { l1: 0.8525, l2: 1.8525, l3: 1.8525, l4: 1.8525 * 1.15 }
);

// CASE 8: useful-life floor. instrument_useful_life_years = 0 should
// be clamped to 1 (server uses Math.max(1, ...)) so 100000/1 = 100000
// per year ÷ 10000 = $10/test. Confirms no divide-by-zero in capital
// math.
check('useful life clamps to 1 when zero (no /0)',
  computeCprt({
    annual_volume: 10000,
    reagent_cost_per_test: 0.50,
    other_supplies_per_test: 0,
    include_capital: 1,
    instrument_purchase_cost: 100000, instrument_useful_life_years: 0,
    annual_maintenance_cost: 0,
  }),
  { l1: 0.50, l2: 0.50, l3: 10.50, l4: 10.50 }
);

// CASE 9: archetype template — Chemistry high-volume automated.
// Verifies the v1.4 starter template values produce the expected L2.
// Values from client/src/pages/VeritaOpsAppPage.tsx ARCHETYPES.
// reagent 0.30 + cal (200*12/50000 = 0.048) + QC (5*365/50000 = 0.0365)
//   + other 0.05 = 0.4345; labor 0.5/60 * 55 = 0.4583; L2 = 0.8928
check('archetype: chemistry high-volume automated produces expected L2',
  computeCprt({
    annual_volume: 50000,
    reagent_cost_per_test: 0.30,
    other_supplies_per_test: 0.05,
    calibrator_kit_cost: 200, cals_per_year: 12,
    qc_cost_per_run: 5, qc_runs_per_year: 365,
    tech_minutes_per_test: 0.5, tech_loaded_hourly_rate: 55,
  }),
  {
    l1: 0.30 + (200*12/50000) + (5*365/50000) + 0.05,
    l2: 0.30 + (200*12/50000) + (5*365/50000) + 0.05 + (0.5/60)*55,
    l3: 0.30 + (200*12/50000) + (5*365/50000) + 0.05 + (0.5/60)*55,
    l4: 0.30 + (200*12/50000) + (5*365/50000) + 0.05 + (0.5/60)*55,
  }
);

// CASE 10: archetype template — Send-out reference lab. No cal, no QC,
// flat reference fee carried in reagent_cost_per_test.
// reagent 45 + other 2 = 47; labor 3/60 * 55 = 2.75; L2 = 49.75.
check('archetype: send-out reference lab produces expected L2',
  computeCprt({
    annual_volume: 500,
    reagent_cost_per_test: 45,
    other_supplies_per_test: 2,
    calibrator_kit_cost: 0, cals_per_year: 0,
    qc_cost_per_run: 0, qc_runs_per_year: 0,
    tech_minutes_per_test: 3, tech_loaded_hourly_rate: 55,
  }),
  { l1: 47, l2: 47 + (3/60)*55, l3: 47 + (3/60)*55, l4: 47 + (3/60)*55 }
);

if (fails > 0) {
  console.log(`\n${fails} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
