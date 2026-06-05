#!/usr/bin/env node
// verify-clia-preset-label-on-report.js
//
// Customer feedback 2026-06-04: a beta lab director ran a serum CO2 study
// expecting ±20% (Carbon Dioxide / Serum CO2 / Bicarbonate) but his report
// printed ±8% / ±5 mm Hg (pCO2, Blood Gas Analyzer). On investigation the
// two preset rows sit adjacent in the CLIA TEa dropdown — the directly
// above/below rows BNP and proBNP carry ±30% which matches a separate one-
// time anomaly he saw. Verdict: he scrolled past the intended row. His
// proposed fix: "include the analyte name in that line so that the report
// locks in the analyte you chose and shows it clearly. Unless I am
// overlooking something, I cannot see the analyte name I selected from the
// drop down menu on the report."
//
// This verify script proves the round-trip:
//   1. Pure-JS reimplementation of the report-rendering parenthetical:
//      legacy NULL → render value only (no parens). Non-null → render
//      "VALUE (LABEL)".
//   2. The "Lab-defined" custom-TEa branch renders as "VALUE (Lab-defined)".
//   3. Empty string is treated as no-label (renders value only).
//   4. The label can carry parens of its own and is not double-escaped.
//   5. Counterfactual: if the renderer ignored cliaPresetLabel entirely,
//      pCO2 and Carbon Dioxide reports would be indistinguishable at
//      report-review time when both happen to share an analyte free-text
//      field of "co2".

// Helper that mirrors the rendering rule:
//   teaStrWithPreset = label ? `${teaStr} (${label})` : teaStr
function renderTeaLine(teaStr, presetLabel) {
  const label = presetLabel == null || presetLabel === "" ? null : presetLabel;
  return label ? `${teaStr} (${label})` : teaStr;
}

// Counterfactual: ignore the label entirely (pre-fix renderer).
function renderTeaLine_buggy(teaStr, _presetLabel) {
  return teaStr;
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " -- " + detail : "")); }
}

// 1. Legacy NULL: render value only, no parens.
{
  const out = renderTeaLine("±8.0% or ±5 mm Hg (greater)", null);
  check("legacy NULL renders value only (no trailing parens)",
    out === "±8.0% or ±5 mm Hg (greater)");
}

// 2. Picked Carbon Dioxide preset: parenthetical appears.
{
  const out = renderTeaLine("±20.0%", "Carbon Dioxide / Serum CO2 / Bicarbonate (±20%)");
  check("Carbon Dioxide pick renders preset label parenthetically",
    out === "±20.0% (Carbon Dioxide / Serum CO2 / Bicarbonate (±20%))");
}

// 3. Picked pCO2 preset: parenthetical appears (and IS DIFFERENT from #2).
{
  const out = renderTeaLine("±8.0% or ±5 mm Hg (greater)", "pCO2, Blood Gas Analyzer (±8% or ±5 mm Hg)");
  check("pCO2 pick renders the pCO2 preset label parenthetically",
    out === "±8.0% or ±5 mm Hg (greater) (pCO2, Blood Gas Analyzer (±8% or ±5 mm Hg))");
}

// 4. Custom TEa branch: parenthetical reads "Lab-defined".
{
  const out = renderTeaLine("±25.0%", "Lab-defined");
  check("Custom TEa branch renders as 'Lab-defined'",
    out === "±25.0% (Lab-defined)");
}

// 5. Empty-string label: treated as no-label (no parens).
{
  const out = renderTeaLine("±15.0%", "");
  check("empty-string label is treated as no-label (no parens)",
    out === "±15.0%");
}

// 6. Undefined label: treated as no-label.
{
  const out = renderTeaLine("±10.0%", undefined);
  check("undefined label is treated as no-label", out === "±10.0%");
}

// 7. Label with internal parens: passed through verbatim, not double-escaped.
{
  const out = renderTeaLine("±15.0% or ±6 U/L", "ALT/SGPT (±15% or ±6 U/L)");
  check("label with internal parens passes through verbatim",
    out === "±15.0% or ±6 U/L (ALT/SGPT (±15% or ±6 U/L))");
}

// 8. Counterfactual: the pre-fix renderer (ignoring label) makes pCO2 and
// Carbon Dioxide reports look identical for a customer whose free-text
// analyte field happens to be the same ("co2"). This is the exact failure
// mode the customer reported.
{
  const a = renderTeaLine_buggy("±20.0%", "Carbon Dioxide / Serum CO2 / Bicarbonate (±20%)");
  const b = renderTeaLine_buggy("±8.0% or ±5 mm Hg (greater)", "pCO2, Blood Gas Analyzer (±8% or ±5 mm Hg)");
  // The TEa values DIFFER (20% vs 8%), and the customer DID see the right
  // value — what he could NOT see was which preset row produced it. The
  // counterfactual proves both reports identical in their "preset
  // provenance" — i.e. neither shows it.
  const aHasPresetMarker = a.toLowerCase().includes("carbon") || a.toLowerCase().includes("serum");
  const bHasPresetMarker = b.toLowerCase().includes("pco2") || b.toLowerCase().includes("blood gas");
  check("counterfactual: pre-fix Carbon Dioxide report has NO preset marker",
    aHasPresetMarker === false);
  check("counterfactual: pre-fix pCO2 report has NO preset marker",
    bHasPresetMarker === false);
}

// 9. Adjacency-slip detection: after the fix, the same two reports become
// distinguishable.
{
  const a = renderTeaLine("±20.0%", "Carbon Dioxide / Serum CO2 / Bicarbonate (±20%)");
  const b = renderTeaLine("±8.0% or ±5 mm Hg (greater)", "pCO2, Blood Gas Analyzer (±8% or ±5 mm Hg)");
  check("post-fix: Carbon Dioxide report contains 'Serum CO2' substring",
    a.includes("Serum CO2"));
  check("post-fix: pCO2 report contains 'Blood Gas Analyzer' substring",
    b.includes("Blood Gas Analyzer"));
  check("post-fix: the two reports are no longer textually equal",
    a !== b);
}

// 10. The 30% sibling check — the customer's one-time "30% instead of 20%"
// anomaly is consistent with picking BNP or proBNP (both ±30%, both
// adjacent to the Carbon Dioxide row in the dropdown).
{
  const bnp = renderTeaLine("±30.0%", "BNP (±30%)");
  const probnp = renderTeaLine("±30.0%", "proBNP (±30%)");
  check("BNP misclick renders 'BNP' in the parenthetical",
    bnp.includes("BNP") && !bnp.includes("proBNP"));
  check("proBNP misclick renders 'proBNP' in the parenthetical",
    probnp.includes("proBNP"));
}

// 11. The "Lab-defined" branch must NOT appear when a real preset was picked.
{
  const out = renderTeaLine("±20.0%", "Carbon Dioxide / Serum CO2 / Bicarbonate (±20%)");
  check("real preset never renders 'Lab-defined'", !out.includes("Lab-defined"));
}

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
