// tests/integration/lod-cbeta-formula.test.ts
//
// BUG-190 (owner pick 2026-11-27, option 1): the detection-limit (LoD) factor. Boots the REAL routes on a scratch SQLite
// file with made-up labs, people and values (tests/integration/inspectionFixture.ts) and proves:
//   1. the old gap: main 25796039 gave cBeta 1.749 at 20 results and 2.063 at 5, where the EP17-A2 formula gives 1.667
//      and 1.755, and a verification whose claim sits between the two LoDs read FAIL
//   2. a study saved and signed before the change (its input names no method) reprints the same numbers and the same
//      pass/fail: the results page's recompute, the records export's computeStudyResults, the PDF's key figures and
//      narrative word for word as main printed them, the stored status, and the boot recompute leaves it as saved
//   3. a new study (the form's builder) uses the formula with L and K from its own data, stores the method, and the
//      screen's recompute and the PDF print the factor with how it was worked out; two samples pool the SD; the director
//      review block stays on page 1
//   4. GET /api/admin/veritacheck/lod-cbeta-change-list: refused without the header, with the secret in the query, to a
//      lab owner's session and to a support login; with it, counts first, then study and lab ids with numbers and no
//      names, the right old and formula values, which pass/fail would change, and nothing written
//   5. who can save and read is unchanged: another customer, a view-only seat, a Staff login and a support login can't
//      save a study in the lab; another customer can't read one
// Run: npm run test:lod-cbeta-formula
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inspectionWorld } from "./inspectionFixture";
import { MAIN_INPUTS, MAIN_RESULTS, MAIN_PDF_STATS, BLANKS, LOW_TWO_SAMPLES } from "./lodFactorFixture";

async function main() {
  const w = await inspectionWorld("lod");
  const { sqlite, base, call, check, one, all, A, X, OWNER, OTHER, EDITOR, VIEWER, STAFF, SUPPORT, ADMIN, finish } = w;
  const { calculateSensitivity } = await import("../../client/src/lib/calculations");
  const { computeStudyResults } = await import("../../client/src/lib/studyResults");
  const { buildSensitivityInput, sensitivityDraftDataPoints } = await import("../../client/src/lib/studyFormPayload");
  const { recomputeAllStudyStatuses } = await import("../../server/routes");
  const { ep17FormulaFactor } = await import("../../shared/lodFactor");
  const fold = (s: string) => s.replace(/\s+/g, " ").trim();
  const statsOf = (t: string) => { const a = t.indexOf("ANALYTE"), b = t.indexOf("REGULATORY COMPLIANCE REFERENCES"); return a >= 0 && b > a ? t.slice(a, b).trim() : t.slice(0, 300); };

  // What Run Study sends for a sensitivity study (VeritaCheckPage handleSubmit), with the given saved input and results.
  const body = (testName: string, input: any, results: any) => ({
    testName, instrument: "Made-up analyzer", analyst: "-", date: "2026-11-01", studyType: "sensitivity", cliaAllowableError: 0, teaIsPercentage: 0,
    teaUnit: "ng/mL", cliaAbsoluteFloor: null, cliaAbsoluteUnit: "ng/mL", cliaPresetLabel: "Set by study type",
    dataPoints: JSON.stringify({ input, results }), instruments: JSON.stringify(["Made-up analyzer"]), status: results.overallPass ? "pass" : "fail", createdAt: new Date().toISOString(),
  });
  const save = async (who: any, lab: number, b: any) => call(who, "POST", `/api/labs/${lab}/studies`, b, lab);
  const sign = (id: number) => sqlite.prepare("UPDATE studies SET lifecycle_state = 'finalized', finalized_at = ?, finalized_by_user_id = ? WHERE id = ?").run("2026-11-02T15:00:00.000Z", OWNER.id, id);
  // The PDF the results page asks for: its own recompute, sent to POST /api/generate-pdf, fetched by token. Text by page.
  const pdfPages = async (study: any, results: any): Promise<string[]> => {
    const t = await call(OWNER, "POST", "/api/generate-pdf", { study, results }, A);
    const r = await fetch(`${base}/api/pdf/${t.j?.token}`);
    const file = path.join(os.tmpdir(), `lod-${w.stamp}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    try {
      return execFileSync("python", ["-E", "-c", "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint('\\f'.join(p.get_text() for p in fitz.open(sys.argv[1])))", file]).toString("utf-8").split("\f").map(fold);
    } finally { fs.unlinkSync(file); }
  };
  const openAsPage = async (id: number) => {
    const g = await call(OWNER, "GET", `/api/labs/${A}/studies/${id}`, undefined, A);
    const dp = JSON.parse(g.j.dataPoints);
    return { status: g.s, study: g.j, stored: dp.results, screen: calculateSensitivity(dp.input), exported: computeStudyResults(g.j) as any };
  };

  // ── 1. The old gap ──
  check("1a. main gave cBeta 1.749 at 20 results from one sample; the formula gives 1.667", MAIN_RESULTS.est20.lod.cBeta === 1.749 && ep17FormulaFactor(20, 1).toFixed(3) === "1.667");
  check("1b. main gave 2.063 at 5 results; the formula gives 1.755", MAIN_RESULTS.est5.lod.cBeta === 2.063 && ep17FormulaFactor(5, 1).toFixed(3) === "1.755");
  check("1c. main judged the verification FAIL (LoD 0.010925 over the 0.0108 claim); the formula's LoD is 0.010759",
    MAIN_RESULTS.ver20.overallPass === false && Math.abs(calculateSensitivity({ ...MAIN_INPUTS.ver20, cbetaMethod: "ep17_formula" }).lod.value - 0.010759) < 1e-6);

  // ── 2. A study saved and signed before the change ──
  const legacy: Record<string, number> = {};
  for (const k of ["est20", "ver20", "est5"] as const) {
    const r = await save(EDITOR, A, body("Made-up Troponin", MAIN_INPUTS[k], MAIN_RESULTS[k]));
    legacy[k] = Number(r.j?.id);
    check(`2a. ${k}: saved as main saved it (input with no method)`, r.s === 200 && legacy[k] > 0, `${r.s} ${r.text.slice(0, 200)}`);
  }
  sign(legacy.est20); sign(legacy.ver20);
  const storedBefore = all("SELECT id, status, data_points, lifecycle_state FROM studies WHERE id IN (?, ?, ?) ORDER BY id", legacy.est20, legacy.ver20, legacy.est5);
  check("2b. the stored verdicts are main's: est20 PASS, ver20 FAIL, est5 PASS", storedBefore.map((r) => r.status).join(",") === "pass,fail,pass", JSON.stringify(storedBefore.map((r) => r.status)));
  for (const k of ["est20", "ver20", "est5"] as const) {
    const o = await openAsPage(legacy[k]);
    check(`2c. ${k}: the results page's recompute is main's result exactly (cBeta ${MAIN_RESULTS[k].lod.cBeta}, LoD, pass/fail, summary)`,
      o.status === 200 && JSON.stringify(o.screen) === JSON.stringify(MAIN_RESULTS[k]) && JSON.stringify(o.stored) === JSON.stringify(MAIN_RESULTS[k]), JSON.stringify(o.screen.lod));
    check(`2d. ${k}: so is the records export's (computeStudyResults)`, JSON.stringify(o.exported) === JSON.stringify(MAIN_RESULTS[k]));
    if (k === "est5") continue;
    const pages = await pdfPages(o.study, o.screen);
    check(`2e. ${k}${k === "est20" ? " (signed)" : " (signed, FAIL)"}: the PDF's figures and narrative are main's word for word`, statsOf(pages[0]) === MAIN_PDF_STATS[k], statsOf(pages[0]));
    check(`2f. ${k}: no formula line, no cp, no "Table A1" on it`, !/cp =|Table A1|LOW-LEVEL SAMPLES/i.test(pages.join(" ")), pages[0].slice(0, 200));
  }
  recomputeAllStudyStatuses();
  const storedAfter = all("SELECT id, status, data_points, lifecycle_state FROM studies WHERE id IN (?, ?, ?) ORDER BY id", legacy.est20, legacy.ver20, legacy.est5);
  check("2g. the boot recompute leaves them exactly as saved (status, data, signed)", JSON.stringify(storedAfter) === JSON.stringify(storedBefore));

  // ── 3. A new study ──
  const form = (lowLevelText: string, mode: "establishment" | "verification" = "establishment") => ({
    mode, analyteName: "Made-up Troponin", units: "ng/mL", blanksText: BLANKS.map((b) => `${b.value},${b.lot}`).join("\n"), lowLevelText,
    loqLevels: [], cvThreshold: 20, biasThreshold: 25, mfgLob: mode === "verification" ? "0.009" : "", mfgLod: mode === "verification" ? "0.0108" : "", mfgLoq: "",
  });
  const runStudy = async (name: string, f: ReturnType<typeof form>) => {
    const input = buildSensitivityInput(f);
    const results = calculateSensitivity(input);
    const r = await save(EDITOR, A, body(name, input, results));
    return { id: Number(r.j?.id), s: r.s, input, results };
  };
  const one20 = await runStudy("Made-up Troponin", form(MAIN_INPUTS.est20.lowLevel.map((r) => String(r.value)).join("\n")));
  const row20 = one("SELECT status, data_points FROM studies WHERE id = ?", one20.id);
  const dp20 = JSON.parse(row20.data_points);
  check("3a. a new study saves the method with its input and its result", one20.s === 200 && dp20.input.cbetaMethod === "ep17_formula" && dp20.results.lod.cbetaMethod === "ep17_formula", JSON.stringify(dp20.results.lod));
  check("3b. ... cp = 1.667 from L = 20 and K = 1, LoD 0.010759 (main's table: 1.749, 0.010925)",
    dp20.results.lod.cBeta.toFixed(3) === "1.667" && dp20.results.lod.nLowLevel === 20 && dp20.results.lod.nLowLevelSamples === 1 && Math.abs(dp20.results.lod.value - 0.010759) < 1e-6);
  const o20 = await openAsPage(one20.id);
  check("3c. ... the results page and the records export recompute the same numbers", JSON.stringify(o20.screen) === JSON.stringify(dp20.results) && JSON.stringify(o20.exported) === JSON.stringify(dp20.results));
  const p20 = await pdfPages(o20.study, o20.screen);
  check("3d. ... the PDF prints the factor and how it was worked out",
    p20[0].includes("LoD = LoB + cp x SD(low level), where cp = 1.645 / (1 - 1/(4 x (L - K))) = 1.667 (L = 20 results, K = 1 sample; CLSI EP17-A2).")
      && /LOW-LEVEL RESULTS \(L\) 20 LOW-LEVEL SAMPLES \(K\) 1 CP \(EP17-A2 CORRECTION FACTOR\) 1\.667/.test(p20[0]) && /LOD 0\.0108 ng\/mL/.test(p20[0]), statsOf(p20[0]));
  check("3e. ... no \"Table A1\", no Cβ label, and the director review block on page 1", !/Table A1|FINITE-SAMPLE|Cβ/i.test(p20.join(" ")) && p20[0].includes("LABORATORY DIRECTOR OR DESIGNEE REVIEW"));
  const ver = await runStudy("Made-up Troponin", form(MAIN_INPUTS.ver20.lowLevel.map((r) => String(r.value)).join("\n"), "verification"));
  check("3f. the verification run again as a new study: PASS with the formula, stored PASS", one("SELECT status FROM studies WHERE id = ?", ver.id).status === "pass" && ver.results.overallPass === true);
  const twoText = LOW_TWO_SAMPLES.map((r, i) => `${r.value},${i % 2 ? "LotA" : ""},${r.sample}`).join("\n");
  const two = await runStudy("Made-up Troponin", form(twoText));
  const dpTwo = JSON.parse(one("SELECT data_points FROM studies WHERE id = ?", two.id).data_points);
  check("3g. two samples labeled on the low-level lines: K = 2 counted from the data, cp = 1.668, the sample kept on each result",
    dpTwo.results.lod.nLowLevelSamples === 2 && dpTwo.results.lod.cBeta.toFixed(3) === "1.668" && dpTwo.input.lowLevel.every((r: any) => r.sample === "S1" || r.sample === "S2"), JSON.stringify(dpTwo.results.lod));
  const pTwo = await pdfPages((await openAsPage(two.id)).study, (await openAsPage(two.id)).screen);
  check("3h. ... the PDF says K = 2 and that the SD is pooled", pTwo[0].includes("= 1.668 (L = 20 results, K = 2 samples; CLSI EP17-A2). SD(low level) is pooled within the samples.") && pTwo[0].includes("LABORATORY DIRECTOR OR DESIGNEE REVIEW"), statsOf(pTwo[0]));

  // A draft (no saved result) and another customer's study saved before, for the change list.
  const draft = await call(EDITOR, "POST", `/api/labs/${A}/studies`, { testName: "Made-up draft", studyType: "sensitivity", status: "draft", dataPoints: JSON.stringify(sensitivityDraftDataPoints(form("0.02\n0.03"))) }, A);
  const xr = await save(OTHER, X, body("Made-up Troponin X", MAIN_INPUTS.est5, MAIN_RESULTS.est5));
  check("3i. a draft and another customer's study saved", draft.s === 200 && xr.s === 200, `${draft.s} ${xr.s}`);

  // ── 4. The admin change list ──
  const route = "/api/admin/veritacheck/lod-cbeta-change-list";
  const get = async (headers: Record<string, string>, q = "") => { const r = await fetch(base + route + q, { headers }); let j: any = null; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  const snap = () => JSON.stringify(all("SELECT * FROM studies ORDER BY id"));
  const before = snap();
  for (const [what, h, q] of [
    ["no header", {}, ""], ["a wrong secret", { "x-admin-secret": "not-it" }, ""], ["the secret in the query", {}, `?secret=${ADMIN}`],
    ["a lab owner's session", { Authorization: `Bearer ${OWNER.token}` }, ""], ["a support login", { Authorization: `Bearer ${SUPPORT.token}` }, ""],
  ] as const) {
    const r = await get(h as Record<string, string>, q);
    check(`4a. refused with ${what}`, r.s === 403 && !r.j?.studies, String(r.s));
  }
  const res = await get({ "x-admin-secret": ADMIN });
  const c = res.j?.counts || {};
  check("4b. with the header: counts first, then by lab, then the studies", res.s === 200 && Object.keys(res.j).join(",") === "counts,byLab,studies", Object.keys(res.j || {}).join(","));
  check("4c. counts: 8 studies, 1 draft not listed, 7 saved, 2 signed, 4 saved with the table, 3 with the formula",
    c.studies === 8 && c.drafts === 1 && c.saved === 7 && c.signed === 2 && c.savedWithTable === 4 && c.savedWithFormula === 3 && res.j.studies.length === 7, JSON.stringify(c));
  check("4d. counts: 1 pass/fail would change (the signed verification, FAIL to PASS); every table LoD would come down",
    c.passFailWouldChange === 1 && c.signedPassFailWouldChange === 1 && c.failToPass === 1 && c.passToFail === 0 && c.lodLower === 4 && c.lodHigher === 0 && c.notEvaluable === 0, JSON.stringify(c));
  const rowOf = (id: number) => res.j.studies.find((s: any) => s.studyId === id);
  const e20 = rowOf(legacy.est20), v20 = rowOf(legacy.ver20), e5 = rowOf(legacy.est5), n20 = rowOf(one20.id), xRow = rowOf(Number(xr.j?.id));
  check("4e. the signed 20-result study: old 1.749 and 0.010925, formula 1.667 and 0.010759, L 20, K 1, pass/fail unchanged",
    e20?.signed === true && e20.savedMethod === "table_2026_05" && e20.old.factor === 1.749 && e20.old.lod === 0.010925 && e20.formula.factor === 1.667 && e20.formula.lod === 0.010759
      && e20.formula.L === 20 && e20.formula.K === 1 && e20.savedPassFail === "pass" && e20.formula.passFail === "pass" && e20.passFailWouldChange === false, JSON.stringify(e20));
  check("4f. the signed verification: FAIL as saved, PASS with the formula, would change", v20?.signed === true && v20.savedPassFail === "fail" && v20.formula.passFail === "pass" && v20.passFailWouldChange === true, JSON.stringify(v20));
  check("4g. the unsigned 5-result study: old 2.063, formula 1.755", e5?.signed === false && e5.old.factor === 2.063 && e5.formula.factor === 1.755, JSON.stringify(e5));
  check("4h. a study saved with the formula: the same either way", n20?.savedMethod === "ep17_formula" && n20.old.factor === n20.formula.factor && n20.old.lod === n20.formula.lod && n20.passFailWouldChange === false, JSON.stringify(n20));
  check("4i. another customer's study is listed under its own lab id", xRow?.labId === X && res.j.byLab[String(X)]?.saved === 1 && res.j.byLab[String(A)]?.saved === 6, JSON.stringify(res.j.byLab));
  const keys = new Set(res.j.studies.flatMap((s: any) => Object.keys(s)));
  const out = JSON.stringify(res.j);
  check("4j. ids and numbers only: no lab name, test name, analyst, instrument, email or person's name",
    !/Made-up|Troponin|analyzer|example\.test|Owner|Editor|Avery|Olive/i.test(out) && [...keys].sort().join(",") === "formula,labId,old,passFailWouldChange,savedMethod,savedPassFail,signed,studyId", [...keys].join(","));
  check("4k. nothing written", snap() === before);

  // ── 5. Who can save and read ──
  const newBody = body("Made-up Troponin", one20.input, one20.results);
  for (const [what, who] of [["another customer", OTHER], ["a view-only seat", VIEWER], ["a Staff login", STAFF], ["a support login", SUPPORT]] as const) {
    const n0 = one("SELECT COUNT(*) AS n FROM studies").n;
    const r = await save(who, A, newBody);
    check(`5a. ${what} can't save a study in the lab`, [401, 403, 404].includes(r.s) && one("SELECT COUNT(*) AS n FROM studies").n === n0, `${r.s} ${r.text.slice(0, 120)}`);
  }
  const theirs = await call(OTHER, "GET", `/api/labs/${A}/studies/${legacy.est20}`, undefined, A);
  check("5b. another customer can't read the lab's study", [403, 404].includes(theirs.s) && !theirs.text.includes("Made-up Troponin"), String(theirs.s));
  const viewer = await call(VIEWER, "GET", `/api/labs/${A}/studies/${legacy.est20}`, undefined, A);
  check("5c. a view-only seat reads it, saved numbers and all", viewer.s === 200 && JSON.stringify(JSON.parse(viewer.j.dataPoints).results) === JSON.stringify(MAIN_RESULTS.est20), String(viewer.s));

  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
