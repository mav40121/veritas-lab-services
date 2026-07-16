// scripts/verify-license-stamp-identity.mjs
//
// Receipt for parking-lot #43: the license stamp must not destroy the §6
// lab-identity header/footer, and the licensee must be the lab the ROUTE
// resolved rather than whatever a request header happened to say.
//
// Why this exists: PR 4's six verify cases all passed against an export that
// was printing a DIFFERENT lab's name in the header and footer of every sheet
// and omitting the CLIA entirely. Those cases tested the row builder; this is a
// different code path. Found only by rendering the workbook and looking at it.
//
// Two halves, tested separately:
//   A. splitHeaderFooter/joinHeaderFooter round-trip and the merge rule.
//   B. the licenseCtxFromReq resolution order, asserted against the shipped
//      source (scope-first, header-resolver as fallback).
//
// Run: node scripts/verify-license-stamp-identity.mjs

import { readFileSync } from "fs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// ── Mirror of the shipped splitter/joiner (shared/licenseExceljs.ts) ─────────
function splitHeaderFooter(s) {
  const out = { L: "", C: "", R: "" };
  const str = String(s || "");
  let section = "C";
  let i = 0;
  while (i < str.length) {
    if (str[i] === "&" && i + 1 < str.length) {
      const next = str[i + 1];
      if (next === "&") { out[section] += "&&"; i += 2; continue; }
      if (next === "L" || next === "C" || next === "R") { section = next; i += 2; continue; }
    }
    out[section] += str[i];
    i += 1;
  }
  return out;
}
function joinHeaderFooter(p) {
  let s = "";
  if (p.L) s += `&L${p.L}`;
  if (p.C) s += `&C${p.C}`;
  if (p.R) s += `&R${p.R}`;
  return s;
}

const LICENSEE = "Michaels Lab";
const FOOTER_LEFT = `© 2026 Veritas Lab Services, LLC | Licensed to: ${LICENSEE} (a@b.com) | Issued 2026-07-16 | Do not redistribute`;
const HEADER_RIGHT = `Licensed: ${LICENSEE}`;

// Mirror of the shipped merge rule.
function stamp(hf) {
  const out = { oddHeader: hf.oddHeader, oddFooter: hf.oddFooter };
  if (!String(out.oddHeader || "").trim()) out.oddHeader = `&R${HEADER_RIGHT}`;
  if (!String(out.oddFooter || "").trim()) {
    out.oddFooter = `&L${FOOTER_LEFT}&RPage &P of &N`;
  } else {
    const p = splitHeaderFooter(out.oddFooter);
    p.L = p.L ? `${p.L}\n${FOOTER_LEFT}` : FOOTER_LEFT;
    out.oddFooter = joinHeaderFooter(p);
  }
  return out;
}

// The real §6 header/footer the VeritaMap export writes (routes.ts:14215-14216).
const LAB = "Michaels Lab", CLIA = "55D5555555";
const SIX_HEADER = `&L&"Calibri,Regular"&10VeritaMap Compliance Map&R&"Calibri,Regular"&10${LAB}    CLIA: ${CLIA}`;
const SIX_FOOTER = `&L&"Calibri,Regular"&9${LAB}    CLIA: ${CLIA}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

console.log("\nCase 1: the splitter survives the codes that appear in real headers");
{
  const p = splitHeaderFooter(SIX_HEADER);
  check("font code &\"Calibri,Regular\" is NOT read as a &C section marker",
    p.C === "", `C=${JSON.stringify(p.C)}`);
  check("left section keeps its title + font codes", p.L === `&"Calibri,Regular"&10VeritaMap Compliance Map`);
  check("right section keeps lab + CLIA", p.R === `&"Calibri,Regular"&10${LAB}    CLIA: ${CLIA}`);
  check("round-trips byte-identical", joinHeaderFooter(p) === SIX_HEADER);
}
{
  const p = splitHeaderFooter(SIX_FOOTER);
  check("footer round-trips byte-identical", joinHeaderFooter(p) === SIX_FOOTER);
  check("page-number codes stay in the center section", p.C.includes("&P of &N"));
  check("product mark stays in the right section", p.R.includes("VeritaAssure"));
}
{
  const escaped = "&LTom && Jerry&RPage";
  const p = splitHeaderFooter(escaped);
  check("escaped && is not mistaken for a section break", p.L === "Tom && Jerry", `L=${JSON.stringify(p.L)}`);
  check("escaped && round-trips", joinHeaderFooter(p) === escaped);
}
{
  const p = splitHeaderFooter("bare text with no markers");
  check("a marker-less string lands in the center section (Excel's default)", p.C === "bare text with no markers");
}

console.log("\nCase 2: a sheet WITH a §6 header/footer keeps its identity (the bug)");
{
  const r = stamp({ oddHeader: SIX_HEADER, oddFooter: SIX_FOOTER });
  check("header is untouched", r.oddHeader === SIX_HEADER);
  check("CLIA still present in the header", r.oddHeader.includes(`CLIA: ${CLIA}`));
  check("CLIA still present in the footer", r.oddFooter.includes(`CLIA: ${CLIA}`));
  check("lab name still present in the footer", r.oddFooter.includes(LAB));
  check("the copyright line was ADDED to the footer, not substituted",
    r.oddFooter.includes("Do not redistribute") && r.oddFooter.includes(`CLIA: ${CLIA}`));
  check("footer center (page numbers) survived", r.oddFooter.includes("&P of &N"));
  check("footer right (product mark) survived", r.oddFooter.includes("VeritaAssure"));
  check("copyright sits UNDER the identity line, not before it",
    r.oddFooter.indexOf(`CLIA: ${CLIA}`) < r.oddFooter.indexOf("Do not redistribute"));
}

console.log("\nCase 3: a sheet with NO header/footer still gets the license (no regression)");
{
  const r = stamp({ oddHeader: "", oddFooter: "" });
  check("license header is applied", r.oddHeader === `&R${HEADER_RIGHT}`);
  check("license footer is applied with page numbers", r.oddFooter === `&L${FOOTER_LEFT}&RPage &P of &N`);
}
{
  const r = stamp({ oddHeader: undefined, oddFooter: undefined });
  check("undefined header/footer behaves like empty", r.oddHeader === `&R${HEADER_RIGHT}`);
}
{
  // Footer present but with an empty left section: copyright fills L, keeps R.
  const r = stamp({ oddHeader: "", oddFooter: "&RPage &P" });
  check("empty left section is filled rather than doubled", r.oddFooter === `&L${FOOTER_LEFT}&RPage &P`);
}

console.log("\nCase 4: stamping twice does not double the copyright line");
{
  const once = stamp({ oddHeader: SIX_HEADER, oddFooter: SIX_FOOTER });
  // applyLicenseToExcelJSWorkbook guards re-entry with STAMP_FLAG_KEY, so a
  // workbook is only ever stamped once. Assert the guard exists in the source.
  const shared = readFileSync(new URL("../shared/licenseExceljs.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  check("re-entry guard STAMP_FLAG_KEY still guards the workbook", /if \(\(workbook as any\)\[STAMP_FLAG_KEY\]\) return;/.test(shared));
  check("single stamp yields exactly one copyright line",
    (once.oddFooter.match(/Do not redistribute/g) || []).length === 1);
}

console.log("\nCase 5: shipped source -- the stamp merges instead of assigning");
{
  const shared = readFileSync(new URL("../shared/licenseExceljs.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const fn = shared.slice(shared.indexOf("function setHeaderFooter"), shared.indexOf("function ensureAboutSheet"));
  check("setHeaderFooter no longer assigns oddHeader unconditionally",
    !/^\s*ws\.headerFooter\.oddHeader = `&R\$\{headerRight\}`;\s*$/m.test(fn) || /if \(!existingHeader\.trim\(\)\)/.test(fn));
  check("it reads the existing header before writing", /const existingHeader = /.test(fn));
  check("it reads the existing footer before writing", /const existingFooter = /.test(fn));
  check("it splits the existing footer rather than overwriting", /splitHeaderFooter\(existingFooter\)/.test(fn));
  check("the splitter is exported to nobody by accident (module-private)", !/export function splitHeaderFooter/.test(shared));
}

console.log("\nCase 6: shipped source -- licenseCtxFromReq prefers the ROUTE's lab");
{
  const routes = readFileSync(new URL("../server/routes.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const raw = routes.slice(routes.indexOf("function licenseCtxFromReq"), routes.indexOf("function licenseCtxFromReq") + 2600);
  // Strip // comment lines before position-matching. The comment above this
  // code NAMES resolveActiveLabForRequest while explaining why it is now the
  // fallback, so an un-stripped search finds the prose ahead of the statement
  // and reports the order backwards. (Same trap as the PR 4 verify, where a
  // comment containing "Age / Sex Band" matched the header search.)
  const fn = raw.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const scopeIdx = fn.indexOf("req?.scope?.lab?.lab_name");
  const resolverIdx = fn.indexOf("resolveActiveLabForRequest");
  check("req.scope.lab is consulted at all", scopeIdx > 0);
  check("req.scope.lab is consulted BEFORE the header resolver",
    scopeIdx > 0 && resolverIdx > 0 && scopeIdx < resolverIdx, `scope@${scopeIdx} resolver@${resolverIdx}`);
  check("the header resolver only runs when scope did not answer",
    /if \(!activeLabName && req\?\.userId\)/.test(fn));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
