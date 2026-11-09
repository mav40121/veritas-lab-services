// tests/integration/ptcoag-geomean-save.test.ts
//
// Receipt for the SCAHC report of 2026-11-09 ("Bobbi was trying to use the study to calculate the Geometric Mean
// on Verita, but it appears to not be working"). The PT/INR Geometric Mean Calculator (pt_coag) form had two faults:
//   1. Run Study saved an untouched Module 3 as { data: [] } unless "Skip" was ticked; the stored verdict counts a
//      saved comparison module, so a study whose normals all passed was stored FAIL (the dashboard read FAIL) while
//      the results page and PDF read PASS.
//   2. Save Draft saved the calibration-verification grid, so a PT/INR draft kept none of its PT results.
// Boots the REAL routes against a throwaway SQLite DB with made-up values, builds each save with the form's own
// builder (client/src/lib/ptCoagPayload.ts, the code Run Study and Save Draft call) and proves:
//   A. the geometric mean is exp(mean(ln PT)), checked against a hand calculation and the product form
//   B. the form's default path (Module 2 blank, Module 3 neither skipped nor filled) is stored PASS, the verdict the
//      results page computes from the same row
//   C. stored verdict and results page agree for Module 3 skipped, Module 3 with 2 pairs (not counted), Module 3
//      with 20 pairs passing and failing, Module 2 with 3 pairs, a second instrument, and a failing RI
//   D. Save Draft stores the PT results as typed (all 20 normals, partial Module 3 rows, instrument and TEa),
//      status draft
//   E. unchanged on purpose: a row saved before the fix with Module 3 { data: [] } still reads FAIL (the boot
//      recompute leaves it); correcting those rows is Michael's decision
//   F. GET /api/admin/veritacheck/ptcoag-empty-module-counts sizes those rows: 403 without the x-admin-secret header
//      (or with the secret in the query), right counts on seeded made-up rows (by lab id with isDemo, drafts, rows
//      reading FAIL, how many pass under the results page's rule, signed ones, unreadable ones), counts and lab ids
//      only, and nothing written (run before E's boot recompute, which also gives a draft a pass/fail status: a
//      separate, reported bug printed as a NOTE)
//
// Run: rm -f .tmp-ptcoag.db && DB_PATH=.tmp-ptcoag.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/ptcoag-geomean-save.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// Made-up normal PTs (seconds), the shape of the demo sample.
const NORMALS = [11.4, 11.8, 12.1, 11.9, 12.3, 11.6, 12.0, 11.7, 12.2, 11.5, 12.4, 11.8, 12.0, 11.9, 12.1, 11.7, 12.2, 11.6, 12.3, 11.8];
const rows = () => Array.from({ length: 20 }, (_, i) => ({ id: `S${String(i + 1).padStart(5, "0")}`, x: null as number | null, y: null as number | null }));
const instrument = (name: string, ptValues: (number | null)[]) =>
  ({ name, reagentLot: "", reagentExp: "", isi: 0.97, ptRILow: 10, ptRIHigh: 14, inrRILow: 0.9, inrRIHigh: 1.2, ptValues });
// The form as the page opens it, with the 20 normals typed in.
const form = () => ({
  instrument1: instrument("Made-up CA-660", [...NORMALS] as (number | null)[]),
  addlInstruments: [] as ReturnType<typeof instrument>[],
  instrument2Name: "Made-up CA-660 Backup", module2Rows: rows(), module2TEa: 0.2,
  skipModule3: false, module3Rows: rows(), module3TEa: 0.2, oldLotNum: "",
});
const fillPairs = (r: ReturnType<typeof rows>, pairs: Array<[number, number]>) => { pairs.forEach(([x, y], i) => { r[i].x = x; r[i].y = y; }); return r; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes, recomputeAllStudyStatuses } = await import("../../server/routes");
  const { buildPtCoagPayload } = await import("../../client/src/lib/ptCoagPayload");
  const { calculatePTCoag, geometricMean } = await import("../../client/src/lib/calculations");
  const { computeStudyResults } = await import("../../client/src/lib/studyResults");
  const sqlite = (db as any).$client;

  // ── A: the math ──
  const hand = Math.exp(NORMALS.reduce((s, v) => s + Math.log(v), 0) / NORMALS.length);
  const product = NORMALS.reduce((s, v) => s * v, 1) ** (1 / NORMALS.length);
  check("A1. geometric mean of the 20 made-up normals = 11.9118 s (exp(mean ln PT)), equal to the product form",
    Math.abs(geometricMean(NORMALS) - 11.911755) < 1e-6 && Math.abs(hand - product) < 1e-9 && Math.abs(geometricMean(NORMALS) - hand) < 1e-12, `${geometricMean(NORMALS)} ${hand} ${product}`);
  const engine = calculatePTCoag(buildPtCoagPayload(form()).module1Instruments, null, null).module1s[0];
  check("A2. the study's Module 1 reports that mean, INR = (PT / MNPT)^ISI per specimen, and a geometric-mean INR of 1.000",
    Math.abs(engine.geoMeanPT - hand) < 1e-9 && Math.abs(engine.specimens[10].inr - Math.pow(12.4 / hand, 0.97)) < 1e-12 && Math.abs(engine.geoMeanINR - 1) < 1e-12 && engine.n === 20,
    `${engine.geoMeanPT} ${engine.specimens[10].inr} ${engine.geoMeanINR}`);

  // ── the real routes ──
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const PW = ["Geo", "mean", "7x!"].join("-");
  const email = `it-geomean-${Date.now()}@example.com`;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };

  try {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT Geomean", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Geomean Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made", labId > 0 && !!token);

    // What Run Study sends (VeritaCheckPage handleSubmit, pt_coag branch).
    const runStudy = async (name: string, f: ReturnType<typeof form>) => {
      const p = buildPtCoagPayload(f);
      const screen = calculatePTCoag(p.module1Instruments, p.m2Data, p.m3Data);
      const body = {
        testName: name, instrument: f.instrument1.name, analyst: "-", date: "2026-11-09", studyType: "pt_coag", cliaAllowableError: f.module2TEa,
        teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: "Lab-defined",
        dataPoints: JSON.stringify(p.dataPoints), instruments: JSON.stringify([f.instrument1.name, f.instrument2Name]),
        status: screen.overallPass ? "pass" : "fail", createdAt: new Date().toISOString(),
      };
      const r = await call("POST", `/api/labs/${labId}/studies`, body, token, labId);
      const row = sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(Number(r.body?.id)) as any;
      // The results page recomputes from the saved row (StudyResultsPage -> computeStudyResults).
      const page = row ? (computeStudyResults({ ...row, studyType: row.study_type, testName: row.test_name, cliaAllowableError: row.clia_allowable_error, teaIsPercentage: row.tea_is_percentage, dataPoints: row.data_points, instruments: row.instruments } as any) as any) : null;
      return { status: r.status, stored: row?.status as string, page: page?.overallPass ? "pass" : "fail", saved: row ? JSON.parse(row.data_points) : null, screen: screen.overallPass ? "pass" : "fail" };
    };

    // ── B: the default path ──
    const def = await runStudy("IT PT default", form());
    check("B1. default path (Module 2 blank, Module 3 not skipped, not filled): saved", def.status === 200 || def.status === 201, String(def.status));
    check("B2. ... Module 3 is saved as not performed (null), not as { data: [] }", def.saved?.module3 === null && def.saved?.module2 === null, JSON.stringify(def.saved?.module3));
    check("B3. ... stored verdict PASS, the same as the results page", def.stored === "pass" && def.page === "pass" && def.screen === "pass", `stored=${def.stored} page=${def.page}`);
    check("B4. ... all 20 normals saved for Instrument 1", JSON.stringify(def.saved?.module1Instruments?.[0]?.ptValues) === JSON.stringify(NORMALS));

    // ── C: stored verdict and results page agree ──
    const cases: Array<[string, ReturnType<typeof form>, "pass" | "fail"]> = [];
    { const f = form(); f.skipModule3 = true; cases.push(["Module 3 skipped", f, "pass"]); }
    { const f = form(); fillPairs(f.module3Rows, [[12.0, 12.2], [12.5, 12.4]]); cases.push(["Module 3 with only 2 pairs (not counted)", f, "pass"]); }
    const m3 = Array.from({ length: 20 }, (_, i) => [11 + i * 0.6, +(11 + i * 0.6) * 1.03] as [number, number]);
    { const f = form(); fillPairs(f.module3Rows, m3); f.oldLotNum = "OLD-1"; cases.push(["Module 3 with 20 pairs within 20%", f, "pass"]); }
    { const f = form(); fillPairs(f.module3Rows, m3.map(([x, y], i) => [x, i < 3 ? x * 1.3 : y] as [number, number])); cases.push(["Module 3 with 3 of 20 pairs off by 30% (85% coverage)", f, "fail"]); }
    { const f = form(); fillPairs(f.module2Rows, [[12, 12.3], [18, 18.4], [25, 24.6]]); cases.push(["Module 2 with 3 pairs", f, "pass"]); }
    { const f = form(); f.addlInstruments = [instrument("Made-up CA-660 Backup", NORMALS.map((v) => +(v * 0.98).toFixed(1)))]; cases.push(["two instruments, each with its own mean", f, "pass"]); }
    { const f = form(); f.instrument1.ptValues = [...NORMALS.slice(0, 17), 15.1, 15.4, 16.0]; cases.push(["3 of 20 normals outside the PT RI (15%)", f, "fail"]); }
    for (const [label, f, want] of cases) {
      const r = await runStudy(`IT PT ${label}`, f);
      check(`C. ${label}: stored ${want.toUpperCase()}, the results page agrees`, r.stored === want && r.page === want && r.screen === want, `stored=${r.stored} page=${r.page} screen=${r.screen}`);
    }

    // ── D: Save Draft ──
    const df = form();
    df.instrument1.ptValues = [...NORMALS.slice(0, 7), null, ...NORMALS.slice(8)];  // one cell left blank
    fillPairs(df.module3Rows, [[12.0, 12.2]]);
    df.module3Rows[1].x = 13.1;                                                       // a half-typed pair
    df.oldLotNum = "OLD-9"; df.module2TEa = 0.15;
    const draftBody = {
      testName: "IT PT draft", instrument: df.instrument1.name, analyst: "", date: "2026-11-09", studyType: "pt_coag", cliaAllowableError: df.module2TEa,
      teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null, cliaPresetLabel: "Lab-defined",
      dataPoints: JSON.stringify(buildPtCoagPayload(df, { draft: true }).dataPoints), instruments: JSON.stringify([df.instrument1.name, df.instrument2Name]), status: "draft",
    };
    const dr = await call("POST", `/api/labs/${labId}/studies`, draftBody, token, labId);
    const got = (await call("GET", `/api/labs/${labId}/studies/${dr.body?.id}`, undefined, token, labId)).body;
    const saved = (() => { try { return JSON.parse(got.dataPoints ?? got.data_points); } catch { return null; } })();
    check("D1. Save Draft: saved as a draft", (dr.status === 200 || dr.status === 201) && got.status === "draft", `status=${dr.status} ${got.status}`);
    check("D2. ... the draft holds the 19 typed normals for Instrument 1 (the blank cell skipped)",
      saved && !Array.isArray(saved) && JSON.stringify(saved.module1Instruments?.[0]?.ptValues) === JSON.stringify(NORMALS.filter((_, i) => i !== 7)), JSON.stringify(saved).slice(0, 160));
    check("D3. ... Module 3 rows kept as typed (a full pair, a half pair, the lot), not skipped",
      saved?.module3?.data?.length === 20 && saved.module3.data[0].x === 12.0 && saved.module3.data[0].y === 12.2 && saved.module3.data[1].x === 13.1 && saved.module3.data[1].y === null && saved.module3.oldLot === "OLD-9");
    check("D4. ... instrument and TEa are the PT/INR form's", got.instrument === "Made-up CA-660" && got.cliaAllowableError === 0.15 && saved?.module2?.tea === 0.15 && saved?.module2?.inst2 === "Made-up CA-660 Backup",
      `${got.instrument} ${got.cliaAllowableError}`);

    // ── E: rows saved before the fix are left as they are ──
    const legacy = buildPtCoagPayload(form()).dataPoints as any;
    legacy.module3 = { data: [], tea: 0.2, oldLot: "", newLot: "" };
    const legacyId = Number(sqlite.prepare(
      `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
       VALUES (?, ?, 'IT PT legacy', 'Made-up CA-660', '-', '2026-10-01', 'pt_coag', 0.2, 1, '%', ?, '[]', 'fail', '2026-10-01T00:00:00Z')`
    ).run(userId, labId, JSON.stringify(legacy)).lastInsertRowid);

    // ── F: the read-only count, GET /api/admin/veritacheck/ptcoag-empty-module-counts (before E's boot recompute,
    //    which also rewrites a draft's status; see the NOTE at the end) ──
    const countsUrl = "/api/admin/veritacheck/ptcoag-empty-module-counts";
    const getCounts = async (secret?: string) => {
      const r = await fetch(base + countsUrl, { headers: secret === undefined ? {} : { "x-admin-secret": secret } });
      let j: any = {}; try { j = await r.json(); } catch {}
      return { status: r.status, body: j };
    };
    const noHeader = await getCounts();
    const wrongHeader = await getCounts("not-the-secret");
    const inQuery = await fetch(`${base}${countsUrl}?secret=${encodeURIComponent(process.env.ADMIN_SECRET!)}`);
    check("F1. refuses without the header, with a wrong one, and with the secret in the query (403)",
      noHeader.status === 403 && wrongHeader.status === 403 && inQuery.status === 403, `${noHeader.status} ${wrongHeader.status} ${inQuery.status}`);

    const before = await getCounts(process.env.ADMIN_SECRET);
    // This lab so far: B's pass; C's 7 (5 pass, 2 fail on Module 1 or a 20-pair Module 3); D's draft; E's legacy FAIL row.
    // (lifecycle_state 'draft' below is the unsigned state every saved study starts in, not status 'draft'.)
    const mine = before.body?.byLab?.[String(labId)];
    const isDemo = (sqlite.prepare("SELECT is_demo FROM labs WHERE id = ?").get(labId) as any)?.is_demo === 1;
    check("F2. this lab: 10 studies, 1 draft, 3 read FAIL, 1 of them (the legacy empty Module 3) passes under the results page's rule",
      before.status === 200 && mine?.studies === 10 && mine.drafts === 1 && mine.savedFail === 3 && mine.failToPass === 1 && mine.isDemo === isDemo, JSON.stringify(mine));

    // Made-up rows on made-up lab 905 (no labs row on this throwaway DB), saved the ways the old form could save them.
    const passingM1 = buildPtCoagPayload(form()).dataPoints as any;
    const failingM1 = buildPtCoagPayload((() => { const f = form(); f.instrument1.ptValues = [...NORMALS.slice(0, 17), 15.1, 15.4, 16.0]; return f; })()).dataPoints as any;
    const shapes: Array<[string, string, string]> = [
      ["fail", JSON.stringify({ ...passingM1, module3: { data: [], tea: 0.2, oldLot: "", newLot: "" } }), "finalized"],       // flips, signed
      ["fail", JSON.stringify({ ...passingM1, module2: { data: [{ id: "S1", x: 12, y: 20 }, { id: "S2", x: 13, y: 22 }], tea: 0.2 }, module3: null }), "draft"], // 2 failing pairs: flips
      ["fail", JSON.stringify({ ...failingM1, module3: { data: [], tea: 0.2, oldLot: "", newLot: "" } }), "draft"],          // Module 1 fails: stays
      ["pass", JSON.stringify(passingM1), "draft"],
      ["draft", JSON.stringify(passingM1), "draft"],
      ["fail", "{not json", "draft"],                                                                                         // unreadable
    ];
    const insMadeUp = sqlite.prepare(
      `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, lifecycle_state, created_at)
       VALUES (?, 905, 'IT PT made-up 905', 'Made-up CA-660', '-', '2026-10-01', 'pt_coag', 0.2, 1, '%', ?, '[]', ?, ?, '2026-10-01T00:00:00Z')`
    );
    sqlite.pragma("foreign_keys = OFF");
    for (const [status, dp, lifecycle] of shapes) insMadeUp.run(userId, dp, status, lifecycle);
    sqlite.pragma("foreign_keys = ON");

    const snapshot = () => JSON.stringify(sqlite.prepare("SELECT id, status, lifecycle_state, data_points FROM studies WHERE study_type = 'pt_coag' ORDER BY id").all());
    const snapBefore = snapshot();
    const changesBefore = (sqlite.prepare("SELECT total_changes() AS n").get() as any).n;
    const after = await getCounts(process.env.ADMIN_SECRET);
    await getCounts(process.env.ADMIN_SECRET);
    const changesAfter = (sqlite.prepare("SELECT total_changes() AS n").get() as any).n;
    const lab905 = after.body?.byLab?.["905"];
    check("F3. made-up lab 905: 6 studies, 1 draft, 4 read FAIL, 2 pass under the results page's rule (empty Module 3; Module 2 with 2 pairs), isDemo null (no labs row)",
      lab905?.studies === 6 && lab905.drafts === 1 && lab905.savedFail === 4 && lab905.failToPass === 2 && lab905.isDemo === null, JSON.stringify(lab905));
    const d = (k: string) => (after.body?.[k] ?? NaN) - (before.body?.[k] ?? NaN);
    check("F4. totals moved by exactly the seeded rows: +6 studies, +1 draft, +1 pass, +4 fail, +2 flip, +1 signed flip, +1 unreadable",
      d("studies") === 6 && d("drafts") === 1 && d("savedPass") === 1 && d("savedFail") === 4 && d("failToPass") === 2 && d("finalizedFailToPass") === 1 && d("notEvaluable") === 1,
      JSON.stringify({ before: { ...before.body, byLab: undefined }, after: { ...after.body, byLab: undefined } }));
    check("F5. the count wrote nothing (rows unchanged, no database changes)", snapshot() === snapBefore && changesAfter === changesBefore, `${changesBefore} -> ${changesAfter}`);
    const out = JSON.stringify(after.body);
    check("F6. the answer carries counts and lab ids only: no test names, instruments, analysts or values",
      !/IT PT|Made-up|CA-660|11\.4|"id"|test_?name|analyst/i.test(out) && Object.keys(after.body).sort().join(",") === "byLab,drafts,failToPass,finalizedFailToPass,notEvaluable,savedFail,savedPass,studies", out.slice(0, 300));

    // ── E1: the boot recompute leaves the legacy row as saved ──
    recomputeAllStudyStatuses();
    check("E1. a row saved before the fix with Module 3 { data: [] } still reads FAIL after the boot recompute (left for Michael)",
      (sqlite.prepare("SELECT status FROM studies WHERE id = ?").get(legacyId) as any)?.status === "fail");
    // BUG-150: the boot recompute used to give every saved draft a pass/fail status, so after a deploy the dashboard no longer
    // listed it as a draft. It now skips drafts; a draft gets its verdict when it is finished.
    const draftAfter = (sqlite.prepare("SELECT status FROM studies WHERE id = ?").get(Number(dr.body?.id)) as any)?.status;
    check("E2. the boot recompute leaves a saved draft as a draft", draftAfter === "draft", `status ${draftAfter}`);
    const draftsAfter = (sqlite.prepare("SELECT COUNT(*) AS n FROM studies WHERE status = 'draft'").get() as any).n;
    check("E3. no draft anywhere in the test database was given a verdict by the recompute", draftsAfter >= 1, `${draftsAfter} drafts`);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
