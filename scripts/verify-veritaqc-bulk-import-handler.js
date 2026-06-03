#!/usr/bin/env node
// verify-veritaqc-bulk-import-handler.js
//
// Offline contract tests for the D-2 (modal -> parent) handoff in the
// VeritaQC Import Option D family. Reproduces the parent-side merge logic
// from handleVeritaQcBulkImport in client/src/pages/VeritaCheckPage.tsx,
// then asserts the resulting qc_range state matches expectations.
//
// What this script proves:
//
//   1. Append-if-missing for analytes / qcLevels / qcAnalyzers grows the
//      grid to fit every imported cell without duplicating existing labels.
//   2. The replicate map (qcRunData) is keyed `${analyte}|${level}|${analyzer}`
//      and replace-by-key on re-import (no append-of-duplicates).
//   3. routing="prior_lot" lands values in qcPriorLotRuns and flips
//      qcShowPriorLot ON; routing="new_lot" leaves the prior-lot grid alone.
//   4. qcNumRuns caps replicate count (the cube can return more, we trim).
//   5. Empty cells array is a no-op (does not blow away state).
//   6. testName auto-sets to the imported analyte when blank, and is NOT
//      clobbered when the user has already typed one.

// Minimal harness: a fake state object that mirrors the React state vars
// touched by handleVeritaQcBulkImport, and a function that applies the same
// merge logic against it. Kept literally aligned with the page-side function
// so a future divergence shows up as a test diff.
function mkState(overrides = {}) {
  return {
    qcAnalytes: [],
    qcLevels: ["Normal", "Abnormal"],
    qcAnalyzers: ["Instrument 1"],
    qcRunData: {},
    qcPriorLotRuns: {},
    qcShowPriorLot: false,
    qcNumRuns: 15,
    qcRangeImportSource: null,
    testName: "",
    ...overrides,
  };
}

function applyBulkImport(state, payload) {
  const s = { ...state };
  const { analyte, cells, routing, import_source, westgard_flag_summary } = payload;
  if (!cells || cells.length === 0) return s;
  if (analyte && !s.qcAnalytes.includes(analyte)) {
    s.qcAnalytes = [...s.qcAnalytes, analyte];
  }
  const newLevels = Array.from(new Set(cells.map(c => c.qc_level)));
  const newInstruments = Array.from(new Set(cells.map(c => c.instrument)));
  s.qcLevels = (() => {
    const next = [...s.qcLevels];
    for (const lvl of newLevels) if (!next.includes(lvl)) next.push(lvl);
    return next;
  })();
  s.qcAnalyzers = (() => {
    const next = [...s.qcAnalyzers];
    for (const inst of newInstruments) if (!next.includes(inst)) next.push(inst);
    return next;
  })();
  const updates = {};
  for (const cell of cells) {
    const key = `${analyte}|${cell.qc_level}|${cell.instrument}`;
    updates[key] = cell.values.slice(0, s.qcNumRuns);
  }
  if (routing === "prior_lot") {
    s.qcPriorLotRuns = { ...s.qcPriorLotRuns, ...updates };
    s.qcShowPriorLot = true;
  } else {
    s.qcRunData = { ...s.qcRunData, ...updates };
  }
  s.qcRangeImportSource = import_source;
  if (analyte && !s.testName.trim()) s.testName = analyte;
  return s;
}

function mkCell(qc_level, instrument, n) {
  return {
    qc_level,
    instrument,
    control_lot: `LOT-${qc_level.toUpperCase()}`,
    control_lot_id: 1,
    target_value: 100,
    target_sd: 5,
    values: Array.from({ length: n }, (_, i) => 100 + (i % 5) * 0.4),
    result_count: n,
    latest_result_date: "2026-06-01",
    was_westgard_flagged_count: 0,
  };
}

function mkPayload(analyte, cells, routing = "new_lot", flag_summary = { total: 0, flagged: 0 }) {
  return {
    analyte,
    cells,
    routing,
    import_source: {
      source: "veritaqc",
      endpoint: "import-analyte-bulk-candidates",
      fetched_at: "2026-06-03T00:00:00Z",
      analyte,
      start_date: null,
      end_date: null,
    },
    westgard_flag_summary: flag_summary,
  };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}

// 1. Append analyte / new levels / new instruments
{
  const state = mkState();
  const cells = [
    mkCell("low",  "Cobas c503", 15),
    mkCell("mid",  "Cobas c503", 15),
    mkCell("mid",  "Cobas c702", 5),
  ];
  const out = applyBulkImport(state, mkPayload("Glucose", cells));
  check("analyte appended", out.qcAnalytes.includes("Glucose"));
  check("qcLevels grew to include low + mid (keeps Normal/Abnormal)",
    out.qcLevels.includes("low") && out.qcLevels.includes("mid") && out.qcLevels.includes("Normal"));
  check("qcAnalyzers grew to include both instruments",
    out.qcAnalyzers.includes("Cobas c503") && out.qcAnalyzers.includes("Cobas c702"));
  check("qcRunData has 3 cells", Object.keys(out.qcRunData).length === 3);
  check("qcRunData uses analyte|level|instrument key",
    "Glucose|low|Cobas c503" in out.qcRunData
    && "Glucose|mid|Cobas c503" in out.qcRunData
    && "Glucose|mid|Cobas c702" in out.qcRunData);
  check("qcPriorLotRuns is empty (new_lot routing)", Object.keys(out.qcPriorLotRuns).length === 0);
  check("qcShowPriorLot stays false (new_lot routing)", out.qcShowPriorLot === false);
  check("testName auto-set to Glucose", out.testName === "Glucose");
  check("import_source captured", out.qcRangeImportSource?.source === "veritaqc");
}

// 2. Replace-by-key on re-import (no duplicate appends)
{
  const seed = mkState({
    qcRunData: { "Glucose|low|Cobas c503": [99, 99, 99] },
  });
  const cells = [mkCell("low", "Cobas c503", 10)];
  const out = applyBulkImport(seed, mkPayload("Glucose", cells));
  check("replicate overwritten not appended",
    out.qcRunData["Glucose|low|Cobas c503"].length === 10
    && out.qcRunData["Glucose|low|Cobas c503"][0] === 100);
}

// 3. qcNumRuns caps the imported replicate count
{
  const state = mkState({ qcNumRuns: 8 });
  const cells = [mkCell("mid", "c503", 22)];
  const out = applyBulkImport(state, mkPayload("Glucose", cells));
  check("imported replicates clipped to qcNumRuns",
    out.qcRunData["Glucose|mid|c503"].length === 8);
}

// 4. routing="prior_lot" lands in qcPriorLotRuns and flips qcShowPriorLot
{
  const state = mkState();
  const cells = [mkCell("mid", "c503", 15)];
  const out = applyBulkImport(state, mkPayload("Glucose", cells, "prior_lot"));
  check("prior_lot routing lands in qcPriorLotRuns",
    "Glucose|mid|c503" in out.qcPriorLotRuns
    && out.qcPriorLotRuns["Glucose|mid|c503"].length === 15);
  check("prior_lot routing leaves qcRunData empty",
    Object.keys(out.qcRunData).length === 0);
  check("prior_lot routing flips qcShowPriorLot on", out.qcShowPriorLot === true);
}

// 5. Empty cells array is a no-op
{
  const seed = mkState({
    qcAnalytes: ["AST"],
    qcRunData: { "AST|low|x": [1, 2, 3] },
    qcRangeImportSource: { source: "prior_import" },
    testName: "Existing study",
  });
  const out = applyBulkImport(seed, mkPayload("Glucose", []));
  check("empty cells leaves qcAnalytes untouched", out.qcAnalytes.length === 1 && out.qcAnalytes[0] === "AST");
  check("empty cells leaves qcRunData untouched", out.qcRunData["AST|low|x"].length === 3);
  check("empty cells leaves testName untouched", out.testName === "Existing study");
  check("empty cells does not overwrite import_source", out.qcRangeImportSource?.source === "prior_import");
}

// 6. testName is NOT clobbered when user has already typed one
{
  const seed = mkState({ testName: "ALT (Pfizer pilot)" });
  const cells = [mkCell("mid", "c503", 10)];
  const out = applyBulkImport(seed, mkPayload("Glucose", cells));
  check("user-typed testName preserved", out.testName === "ALT (Pfizer pilot)");
  check("qcAnalytes still appended", out.qcAnalytes.includes("Glucose"));
}

// 7. Duplicate-analyte re-import does NOT duplicate the analyte chip
{
  const seed = mkState({ qcAnalytes: ["Glucose"] });
  const cells = [mkCell("high", "c702", 10)];
  const out = applyBulkImport(seed, mkPayload("Glucose", cells));
  check("re-import does not duplicate analyte",
    out.qcAnalytes.filter(a => a === "Glucose").length === 1);
}

// 8. Multi-analyte workflow: two consecutive imports stack
{
  let state = mkState();
  state = applyBulkImport(state, mkPayload("Glucose", [mkCell("mid", "c503", 10)]));
  state = applyBulkImport(state, mkPayload("ALT",     [mkCell("mid", "c503", 10), mkCell("mid", "c702", 5)]));
  check("two imports => two analytes",
    state.qcAnalytes.length === 2 && state.qcAnalytes.includes("Glucose") && state.qcAnalytes.includes("ALT"));
  check("two imports => 3 distinct grid keys",
    Object.keys(state.qcRunData).length === 3);
}

// 9. Mixed routing in the same session: first new_lot, then prior_lot
{
  let state = mkState();
  state = applyBulkImport(state, mkPayload("Glucose", [mkCell("mid", "c503", 10)], "new_lot"));
  state = applyBulkImport(state, mkPayload("Glucose", [mkCell("mid", "c503", 10)], "prior_lot"));
  check("new_lot grid populated then prior_lot grid populated independently",
    state.qcRunData["Glucose|mid|c503"]?.length === 10
    && state.qcPriorLotRuns["Glucose|mid|c503"]?.length === 10);
  check("qcShowPriorLot flipped on by the prior_lot import", state.qcShowPriorLot === true);
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
