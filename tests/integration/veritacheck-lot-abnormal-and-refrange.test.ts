// tests/integration/veritacheck-lot-abnormal-and-refrange.test.ts
//
// Receipt for two VeritaCheck verdict bugs (2026-11-10). Boots the REAL routes against a throwaway SQLite DB
// (DB_PATH from the runner) with made-up values only.
//
// BUG-157, "Lot-to-lot 'Abnormal Only' counts no pairs": the Abnormal Only form types into the one Specimen Data grid,
// whose rows carry cohort "Normal", and the screen, the stored verdict and the PDF all kept only rows labeled
// "Abnormal" for that study, so every Abnormal Only study read N = 0 and FAIL. Proves:
//   A1. an Abnormal Only study as Run Study saves it counts its 20 pairs on the results page, in the stored verdict and
//       in the PDF, PASS when they are within TEa and FAIL (with N = 20) when they are not
//   A2. Normal Only and Both read as before, and Edit of an Abnormal Only study keeps its pairs if switched to Both
//   A3. the boot recompute leaves Abnormal Only rows saved under the old reading as saved
// BUG-155, "Reference range verification: with blank or censored results, the saved PASS/FAIL can differ from the
// results page": the stored verdict counted blank cells as specimens (outside the range whenever the low limit is above
// 0), read a censored "<x" or ">x" as in range whatever the study's censoring policy, and had no 20-result minimum. It
// now uses the results page's own calculator. Proves:
//   B1. blank cells, a censored result under exclude and under substitute: results page, stored verdict and PDF agree
//   B2. the boot recompute leaves reference range rows saved under the old reading as saved, and still corrects a row
//       the old and new readings judge the same way
// C. GET /api/admin/veritacheck/lot-abnormal-refrange-counts refuses without the secret, answers counts and lab ids
//    only, says how many saved verdicts the new rules would change, and writes nothing.
//
// Run: rm -f .tmp-lotref.db && DB_PATH=.tmp-lotref.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritacheck-lot-abnormal-and-refrange.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`);
  if (cond) passes++; else failures++;
}
const verdictOf = (r: any) => (r && typeof r.overallPass === "boolean" ? (r.overallPass ? "pass" : "fail") : `none (${r?.error ?? "no result"})`);
const count = (s: string, needle: string) => s.split(needle).length - 1;

// ── Made-up values ──────────────────────────────────────────────────────────
// Abnormal Only lot-to-lot: 20 made-up high glucose pairs (mg/dL), new lot within 2% of current (TEa 10%).
const CUR = Array.from({ length: 20 }, (_, i) => 200 + 10 * i);
const within = CUR.map((c, i) => +(c * (i % 2 ? 1.02 : 0.98)).toFixed(1));
const outside = CUR.map((c) => +(c * 1.2).toFixed(1));
// The Specimen Data grid the Abnormal Only form types into: lotData, whose rows carry cohort "Normal".
const grid = (news: number[], cohort: "Normal" | "Abnormal" = "Normal") =>
  CUR.map((c, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, currentLot: c, newLot: news[i], cohort }));
const emptyAbnormal = () => Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, currentLot: null, newLot: null, cohort: "Abnormal" as const }));
const lotForm = (sampleType: "normal" | "abnormal" | "both", data: any[], dataAbnormal: any[] = emptyAbnormal()) => ({
  sampleType, currentLotNum: "CUR-MU-1", currentLotExp: "", newLotNum: "NEW-MU-1", newLotExp: "",
  analyte: "Made-up Glucose", units: "mg/dL", numSpecimens: 20, data, dataAbnormal,
});

// Reference range: made-up sodium, 135 to 145 mmol/L.
const C = (v: number, dir: "below" | "above" = "below") => ({ censored: true as const, censor_direction: dir, censor_value: v });
const inside = (n: number) => Array.from({ length: n }, (_, i) => 136 + (i % 9));
const refData = (values: any[]) => ({
  specimens: values.map((value, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, value })),
  refLow: 135, refHigh: 145, analyte: "Made-up Sodium", units: "mmol/L",
});
// Each case: the values, the censoring policy, what the old stored reading gave, what the results page shows.
const REF_CASES: Array<{ name: string; values: any[]; policy: string; old: "pass" | "fail"; page: "pass" | "fail"; n: number }> = [
  { name: "20 rows, 2 blank, 18 in range", values: [...inside(18), null, null], policy: "exclude", old: "pass", page: "fail", n: 18 },
  { name: "23 rows, 3 blank, 20 in range", values: [...inside(20), null, null, null], policy: "exclude", old: "fail", page: "pass", n: 20 },
  { name: "20 rows, 19 in range and a censored <120 (exclude)", values: [...inside(19), C(120)], policy: "exclude", old: "pass", page: "fail", n: 19 },
  { name: "20 rows, 17 in range, 1 at 147, two <100 (substitute the limit)", values: [...inside(17), 147, C(100), C(100)], policy: "substitute_lld", old: "pass", page: "fail", n: 20 },
];

async function main() {
  const { db } = await import("../../server/db");
  const routes: any = await import("../../server/routes");
  const { computeStudyStatus, recomputeAllStudyStatuses, registerRoutes } = routes;
  const { calculateLotToLot } = await import("../../client/src/lib/calculations");
  const { computeStudyResults } = await import("../../client/src/lib/studyResults");
  const lib = await import("../../client/src/lib/studyFormPayload");
  const pdf: any = await import("../../server/pdfReport");
  const sqlite = (db as any).$client;

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number, headers: Record<string, string> = {}) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };

  try {
    const PW = ["Lot", "ref", "7x!"].join("-");
    const email = `it-lotref-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT Lot Ref", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Lot Ref Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made", labId > 0 && !!token);
    const getRow = async (id: number) => (await call("GET", `/api/labs/${labId}/studies/${id}`, undefined, token, labId)).body;
    // Run Study: what handleSubmit sends for the type (the server recomputes the status).
    const runStudy = async (studyType: string, testName: string, dataPoints: unknown, extra: Record<string, unknown> = {}) => {
      const r = await call("POST", `/api/labs/${labId}/studies`, {
        testName, instrument: "Made-up Analyzer", analyst: "-", date: "2026-11-10", studyType, cliaAllowableError: 0.1,
        teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: "Lab-defined",
        dataPoints: JSON.stringify(dataPoints), instruments: JSON.stringify(["Made-up Analyzer"]), status: "pass", createdAt: new Date().toISOString(), ...extra,
      }, token, labId);
      return getRow(Number(r.body?.id));
    };

    // ── A1. Abnormal Only, as Run Study saves it ──
    for (const [label, news, want] of [["pairs within 2%", within, "pass"], ["pairs 20% apart", outside, "fail"]] as const) {
      const f = lotForm("abnormal", grid(news as number[]));
      const { allData, dataPoints } = lib.buildLotToLotPayload(f as any);
      const form = calculateLotToLot(allData as any, 0.1, "abnormal");
      check(`A1. Abnormal Only, ${label}: the form's result counts 20 pairs in the Abnormal cohort, ${want.toUpperCase()}`,
        form.cohorts.length === 1 && form.cohorts[0].cohort === "Abnormal" && form.cohorts[0].n === 20 && form.totalCount === 20 && verdictOf(form) === want,
        `cohorts ${JSON.stringify(form.cohorts.map((c) => [c.cohort, c.n]))} ${verdictOf(form)}`);
      const row = await runStudy("lot_to_lot", `IT abnormal only ${label}`, dataPoints);
      const page: any = computeStudyResults(row as any);
      check(`A1. Abnormal Only, ${label}: the results page counts 20 pairs, ${want.toUpperCase()}`,
        page?.cohorts?.[0]?.n === 20 && page?.totalCount === 20 && verdictOf(page) === want, `N ${page?.cohorts?.[0]?.n} ${verdictOf(page)}`);
      check(`A1. Abnormal Only, ${label}: the stored verdict is the results page's (${want.toUpperCase()})`, row?.status === want, `stored ${row?.status}`);
      const html: string = pdf.buildLotToLotHTML(row, page);
      check(`A1. Abnormal Only, ${label}: the PDF lists the 20 pairs under the Abnormal cohort and reads ${want.toUpperCase()}`,
        html.includes("Abnormal Cohort - Individual Results") && count(html, `<td class="text-right ${want}">${want === "pass" ? "Pass" : "Fail"}</td>`) === 20
          && html.includes(`<td class="${want}">${want.toUpperCase()}</td>`) && html.includes(`${want === "pass" ? 20 : 0}/20`),
        `rows ${count(html, '<td class="text-right pass">Pass</td>')}+${count(html, '<td class="text-right fail">Fail</td>')}`);
      if (want === "pass") {
        const saved = JSON.parse(row?.dataPoints || "{}");
        check("A1. the saved Abnormal Only pairs are labeled Abnormal", Array.isArray(saved.data) && saved.data.length === 20 && saved.data.every((d: any) => d.cohort === "Abnormal"),
          JSON.stringify(saved.data?.[0]));
        // Edit reads them back into the Specimen Data grid; switched to Both, they are the Normal cohort's pairs, not lost.
        const back: any = lib.readStudyForms(row).lot_to_lot;
        const asBoth = back ? lib.buildLotToLotPayload({ ...back, sampleType: "both" }).allData : [];
        const bothRes = calculateLotToLot(asBoth as any, 0.1, "both");
        check("A2. Edit of an Abnormal Only study: the 20 pairs are back in the grid, and switched to Both they are the Normal cohort",
          back?.sampleType === "abnormal" && back.data.filter((d: any) => d.currentLot !== null).length === 20 && bothRes.cohorts[0].n === 20 && bothRes.cohorts[1].n === 0,
          JSON.stringify(bothRes.cohorts.map((c) => [c.cohort, c.n])));
      }
    }
    // ── A2. Normal Only and Both read as before ──
    {
      const normal = lib.buildLotToLotPayload(lotForm("normal", grid(within)) as any);
      const nRow = await runStudy("lot_to_lot", "IT normal only", normal.dataPoints);
      const nPage: any = computeStudyResults(nRow as any);
      check("A2. Normal Only: 20 pairs in the Normal cohort, PASS on the results page and stored", nPage?.cohorts?.[0]?.cohort === "Normal" && nPage.cohorts[0].n === 20 && verdictOf(nPage) === "pass" && nRow?.status === "pass",
        `${nPage?.cohorts?.[0]?.cohort} ${nPage?.cohorts?.[0]?.n} ${nRow?.status}`);
      const abn = CUR.slice(0, 10).map((c, i) => ({ specimenId: `A${i + 1}`, currentLot: c, newLot: +(c * 1.2).toFixed(1), cohort: "Abnormal" as const }));
      const both = lib.buildLotToLotPayload(lotForm("both", grid(within).slice(0, 10), abn) as any);
      const bRow = await runStudy("lot_to_lot", "IT both cohorts", both.dataPoints);
      const bPage: any = computeStudyResults(bRow as any);
      check("A2. Both: Normal 10 pairs PASS, Abnormal 10 pairs FAIL, overall FAIL on the results page and stored",
        bPage?.cohorts?.length === 2 && bPage.cohorts[0].n === 10 && bPage.cohorts[0].pass === true && bPage.cohorts[1].n === 10 && bPage.cohorts[1].pass === false && verdictOf(bPage) === "fail" && bRow?.status === "fail",
        `${JSON.stringify(bPage?.cohorts?.map((c: any) => [c.cohort, c.n, c.pass]))} ${bRow?.status}`);
    }

    // ── B1. Reference range: results page, stored verdict and PDF agree ──
    for (const c of REF_CASES) {
      const dp = refData(c.values);
      const stored = computeStudyStatus("ref_interval", JSON.stringify(dp), "[\"Made-up Analyzer\"]", 0.1, true, null, c.policy);
      let row: any;
      if (c.policy === "exclude") row = await runStudy("ref_interval", `IT ref ${c.name}`, dp);
      else row = { ...(await runStudy("ref_interval", `IT ref ${c.name}`, dp)), censoringPolicy: c.policy };
      const page: any = computeStudyResults(row as any);
      check(`B1. ${c.name}: the results page shows N ${c.n}, ${c.page.toUpperCase()}`, page?.n === c.n && verdictOf(page) === c.page, `N ${page?.n} ${verdictOf(page)}`);
      check(`B1. ${c.name}: the stored verdict is the results page's (${c.page.toUpperCase()}; the old reading gave ${c.old.toUpperCase()})`,
        stored === c.page && (c.policy !== "exclude" || row?.status === c.page), `computeStudyStatus ${stored}, saved row ${row?.status}`);
      const build = pdf.buildRefIntervalHTML;
      const html: string = typeof build === "function" ? build(row, page) : "";
      const pdfText = c.page === "pass" ? "Meets CLSI EP28-A3c criteria" : "Does not meet CLSI EP28-A3c criteria";
      check(`B1. ${c.name}: the PDF reads N ${c.n} and "${pdfText}"`, html.includes(`Specimens Tested</div><div class="stat-value">${c.n}</div>`) && html.includes(pdfText),
        typeof build === "function" ? "the PDF text differs" : "buildRefIntervalHTML is not exported");
    }

    // ── A3 and B2. The boot recompute leaves rows saved under the old readings as saved ──
    sqlite.pragma("foreign_keys = OFF");
    const ins = sqlite.prepare(
      `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at, censoring_policy, lifecycle_state)
       VALUES (1, ?, ?, 'Made-up Analyzer', 'made-up', '2026-11-01', ?, 0.1, 1, '%', ?, '["Made-up Analyzer"]', ?, '2026-11-01T00:00:00Z', ?, ?)`
    );
    // Made-up lab ids 951 to 954 have no labs row on this throwaway DB; the counts read groups by the number.
    const oldAbnormal = Number(ins.run(951, "Made-up Glucose", "lot_to_lot", JSON.stringify({ data: grid(within), sampleType: "abnormal" }), "fail", "exclude", "finalized").lastInsertRowid);
    const oldNoType = Number(ins.run(951, "Made-up Glucose", "lot_to_lot", JSON.stringify({ data: grid(within) }), "fail", "exclude", "draft").lastInsertRowid);
    const oldAbnormalDraft = Number(ins.run(951, "Made-up Glucose", "lot_to_lot", JSON.stringify({ data: grid(within), sampleType: "abnormal" }), "draft", "exclude", "draft").lastInsertRowid);
    const bothWrong = Number(ins.run(952, "Made-up Glucose", "lot_to_lot", JSON.stringify({ data: [...grid(within).slice(0, 10), ...grid(within, "Abnormal").slice(10)], sampleType: "both" }), "fail", "exclude", "draft").lastInsertRowid);
    const oldRef = REF_CASES.map((c) => Number(ins.run(953, "Made-up Sodium", "ref_interval", JSON.stringify(refData(c.values)), c.old, c.policy, "draft").lastInsertRowid));
    const refWrong = Number(ins.run(954, "Made-up Sodium", "ref_interval", JSON.stringify(refData([...inside(17), 133, 147, 150])), "pass", "exclude", "draft").lastInsertRowid);
    sqlite.pragma("foreign_keys = ON");
    const status = (id: number) => (sqlite.prepare("SELECT status FROM studies WHERE id = ?").get(id) as any)?.status;
    const oldPage: any = computeStudyResults({ id: oldAbnormal, testName: "Made-up Glucose", studyType: "lot_to_lot", cliaAllowableError: 0.1, teaIsPercentage: 1, dataPoints: JSON.stringify({ data: grid(within), sampleType: "abnormal" }), instruments: "[\"Made-up Analyzer\"]" } as any);
    check("A3. an Abnormal Only study saved before the fix now shows its 20 pairs on the results page (PASS)", oldPage?.cohorts?.[0]?.n === 20 && verdictOf(oldPage) === "pass", `N ${oldPage?.cohorts?.[0]?.n} ${verdictOf(oldPage)}`);
    const beforeRecompute = { ref: oldRef.map(status) };
    recomputeAllStudyStatuses();
    check("A3. boot recompute leaves a signed Abnormal Only row saved FAIL under the old reading as saved", status(oldAbnormal) === "fail", status(oldAbnormal));
    check("A3. ... and a row with no sample type saved (read as Abnormal Only) as saved", status(oldNoType) === "fail", status(oldNoType));
    check("A3. ... and leaves an Abnormal Only draft a draft", status(oldAbnormalDraft) === "draft", status(oldAbnormalDraft));
    check("A3. boot recompute still corrects a Both row whose saved verdict is wrong under either reading (fail -> pass)", status(bothWrong) === "pass", status(bothWrong));
    check("B2. boot recompute leaves the 4 reference range rows saved under the old reading as saved",
      JSON.stringify(oldRef.map(status)) === JSON.stringify(REF_CASES.map((c) => c.old)) && JSON.stringify(beforeRecompute.ref) === JSON.stringify(REF_CASES.map((c) => c.old)), JSON.stringify(oldRef.map(status)));
    check("B2. boot recompute still corrects a reference range row both readings judge the same way (20 numbers, 3 outside: pass -> fail)", status(refWrong) === "fail", status(refWrong));

    // ── C. The counts read ──
    const noSecret = await call("GET", "/api/admin/veritacheck/lot-abnormal-refrange-counts");
    check("C. counts read refuses without the secret (403)", noSecret.status === 403, String(noSecret.status));
    const wrong = await call("GET", "/api/admin/veritacheck/lot-abnormal-refrange-counts", undefined, undefined, undefined, { "x-admin-secret": "not-the-secret" });
    check("C. counts read refuses a wrong secret (403)", wrong.status === 403, String(wrong.status));
    const r = await call("GET", "/api/admin/veritacheck/lot-abnormal-refrange-counts", undefined, undefined, undefined, { "x-admin-secret": process.env.ADMIN_SECRET! });
    const j: any = r.body;
    check("C. counts read answers 200", r.status === 200, String(r.status));
    const l = j?.lotToLot, f = j?.refInterval;
    check("C. lot-to-lot held rows: 3 (two saved FAIL, one draft), both FAILs would read PASS, one of them signed",
      l?.studies === 3 && l.drafts === 1 && l.savedFail === 2 && l.wouldChange === 2 && l.failToPass === 2 && l.finalizedWouldChange === 1 && l.bySampleType?.abnormal === 2 && l.bySampleType?.missing === 1,
      JSON.stringify(l));
    // The reference range rows saved through Run Study above hold blanks or censored results too; they were saved under
    // the new rule, so they are held but would not change. The 4 inserted rows change.
    check("C. reference range held rows: the 4 saved under the old reading would change (2 pass -> fail ... ), the ones saved since would not",
      f?.wouldChange === 4 && f.passToFail === 3 && f.failToPass === 1 && f.studies >= 4 && f.withBlank >= 2 && f.withCensored >= 2 && f.fewerThan20Results >= 2,
      JSON.stringify(f));
    check("C. counts by lab id: 951 has 2 changing lot rows, 953 has 4 changing reference range rows, 952 and 954 are not held",
      j?.byLab?.["951"]?.lotToLot === 3 && j.byLab["951"].wouldChange === 2 && j.byLab?.["953"]?.refInterval === 4 && j.byLab["953"].wouldChange === 4 && !j.byLab["952"] && !j.byLab["954"],
      JSON.stringify(j?.byLab));
    const text = JSON.stringify(j);
    check("C. counts read carries no study id, test name, analyst or values", !text.includes(`"id"`) && !text.includes("Made-up") && !text.includes("made-up") && !text.includes("136") && !text.includes("IT "), text.slice(0, 300));
    check("C. the counts read wrote nothing", status(oldAbnormal) === "fail" && status(oldNoType) === "fail" && JSON.stringify(oldRef.map(status)) === JSON.stringify(REF_CASES.map((c) => c.old)));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? `\nALL PASS (${passes})` : `\n${failures} FAILED, ${passes} passed`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
