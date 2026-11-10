// tests/integration/veritacheck-edit-criterion.test.ts
//
// Receipt for BUG-153 and BUG-154 (found 2026-11-10 while fixing BUG-146).
//   BUG-153: Edit didn't put the saved acceptance criterion back in the picker. The picker stayed on the first preset
//            (ALT/SGPT, ±15% or ±6 U/L), so a re-run from Edit was judged on ALT unless the tech picked the criterion
//            again: a Sodium ±4 mmol/L study re-run from Edit was saved as ALT ±15%.
//   BUG-154: both study PUTs wrote the criterion's value and preset label but not its units (tea_is_percentage,
//            tea_unit) or its floor (clia_absolute_floor, clia_absolute_unit), so a criterion changed in Edit was
//            saved half-changed; and a draft re-save wrote no label at all (NULL), which BUG-139's startup floor
//            backfill then treats as a legacy row.
// Boots the REAL routes against a throwaway SQLite DB with made-up values. The page's Edit is modeled with
// client/src/lib/studyFormPayload.ts (readCriterionForm: what Edit puts in the picker; criterionOf: what the page
// saves from the picker). On main neither exists; the test then models main's page (the picker left on preset 0, the
// saved value in the custom box), so the same checks show the bug there.
//   E. Edit of a saved study or draft: the picker shows the saved criterion (label, value, percent or units, floor)
//   R. Run Study again from Edit (PUT): the six criterion columns are unchanged and so is the stored verdict
//   C. a criterion changed in Edit is saved whole: value, units, floor and label, on both PUTs, draft or finished
//   K. a body that doesn't carry a criterion field leaves that column as it was
//
// Run: rm -f .tmp-edit-crit.db && DB_PATH=.tmp-edit-crit.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritacheck-edit-criterion.test.ts
import http from "node:http";
import express from "express";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// The page's own preset list, read from its source (the scripts that pin it read it the same way).
const pageSrc = readFileSync(new URL("../../client/src/pages/VeritaCheckPage.tsx", import.meta.url), "utf-8");
const PRESETS: any[] = new Function(`return [${pageSrc.match(/const CLIA_PRESETS = \[([\s\S]*?)\n\];/)![1]}\n];`)();
const presetAt = (label: string) => { const i = PRESETS.findIndex((p) => p.label === label); if (i < 0) throw new Error(`no preset ${label}`); return i; };
const SODIUM = "Sodium (±4 mmol/L)";
const GLUCOSE = "Glucose (±8% or ±6 mg/dL)";
const ALBUMIN = "Albumin (±8%)";
const ALT = PRESETS[0].label;

type Pick = { presetIndex: number; customClia: number; customAbsFloor: number | null; customAbsUnit: string; saved: any | null };
const PAGE_DEFAULT: Pick = { presetIndex: 0, customClia: 0.15, customAbsFloor: null, customAbsUnit: "", saved: null };

// main's page, for the bite proof: the hydrate left cliaPreset at 0 and put the saved value, floor and unit in the
// custom fields; the criterion came from the picker (VeritaCheckPage.tsx before this fix).
const mainEditPick = (row: any): Pick => ({
  presetIndex: 0, customClia: typeof row.cliaAllowableError === "number" ? row.cliaAllowableError : 0.15,
  customAbsFloor: typeof row.cliaAbsoluteFloor === "number" ? row.cliaAbsoluteFloor : null,
  customAbsUnit: typeof row.cliaAbsoluteUnit === "string" ? row.cliaAbsoluteUnit : "", saved: null,
});
const mainCriterion = (s: Pick) => {
  const p = PRESETS[s.presetIndex];
  const isCustom = s.presetIndex === PRESETS.length - 1;
  const floor = isCustom && s.customAbsFloor != null && s.customAbsFloor > 0 ? s.customAbsFloor : null;
  return {
    cliaValue: p.value !== 0 ? p.value : s.customClia,
    teaIsPercentage: p.isPercentage !== false,
    teaUnit: p.unit || "%",
    cliaAbsoluteFloor: isCustom ? floor : (p.absoluteFloor ?? null),
    cliaAbsoluteUnit: isCustom ? (floor != null ? (s.customAbsUnit.trim() || null) : null) : (p.absoluteUnit ?? null),
    cliaPresetLabel: p.value !== 0 ? p.label : "Lab-defined",
  };
};

// ── Made-up study data ─────────────────────────────────────────────────────────
const AN = "Made-up Analyzer";
const grid = (pairs: Array<[number, number]>) => pairs.map(([e, v], i) => ({ level: i + 1, expectedValue: e, instrumentValues: { [AN]: v } }));
const precisionForm = (vals: number[][]) => ({
  mode: "simple" as const, levels: vals.length, levelNames: ["Made-up Low", "Made-up High", "Level 3 (Mid)"], values: [...vals, [], []].slice(0, 3) as any[][],
  reps: 20, days: 5, runsPerDay: 1, replicatesPerRun: 2, advancedData: [[], [], []] as any[][][],
  vendorSd: "", vendorSdConc: "", targetMean: "", targetCv: "", controlLot: "", reagentLot: "", comment: "", resultUnits: "mmol/L", importSource: null,
});
const lotForm = () => ({
  sampleType: "normal" as const, currentLotNum: "CUR-MU", currentLotExp: "", newLotNum: "NEW-MU", newLotExp: "", analyte: "Made-up Sodium", units: "mmol/L", numSpecimens: 5,
  data: [[140, 141], [138, 139.5], [142, 141], [136, 137], [145, 146]].map(([c, n], i) => ({ specimenId: `S00${i + 1}`, currentLot: c, newLot: n, cohort: "Normal" as const })),
  dataAbnormal: [],
});
const linForm = () => ({
  analyte: "Made-up Albumin", units: "g/dL", replicatesPerLevel: 2, claimedLow: "" as const, claimedHigh: "" as const, importSource: null,
  levels: [["L1", 1.5], ["L2", 3.0], ["L3", 4.5], ["L4", 6.0]].map(([name, assignedValue]) => ({ name: name as string, assignedValue: assignedValue as number })),
  runData: { L1: [1.52, 1.49], L2: [3.02, 2.98], L3: [4.48, 4.55], L4: [6.05, 5.97] } as Record<string, number[]>,
});

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes, computeStudyStatus } = await import("../../server/routes");
  const lib: any = await import("../../client/src/lib/studyFormPayload");
  const sqlite = (db as any).$client;
  const onMain = typeof lib.readCriterionForm !== "function";
  console.log(onMain ? "(studyFormPayload has no readCriterionForm: modeling main's page)" : "(modeling the page through studyFormPayload readCriterionForm/criterionOf)");

  // What Edit puts in the picker, and what the page then saves from it.
  const editPick = (row: any): Pick => {
    if (onMain) return mainEditPick(row);
    const r = lib.readCriterionForm(row, PRESETS);
    return { ...PAGE_DEFAULT, presetIndex: r.presetIndex, ...(r.custom ? { customClia: r.custom.clia, customAbsFloor: r.custom.absFloor, customAbsUnit: r.custom.absUnit } : {}), saved: r.saved };
  };
  const criterion = (s: Pick) => (onMain ? mainCriterion(s) : lib.criterionOf(PRESETS, s));
  // What the picker shows: the "as saved" entry when Edit holds the saved criterion, else the selected preset.
  const pickerShows = (s: Pick) => (s.saved ? `As saved: ${s.saved.label ?? "(no preset label)"}` : PRESETS[s.presetIndex].label);

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const PW = ["Edit", "crit", "7x!"].join("-");
  const email = `it-edit-crit-${Date.now()}@example.com`;
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
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT Edit Criterion", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Edit Criterion Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made", labId > 0 && !!token);
    const getRow = async (id: number) => (await call("GET", `/api/labs/${labId}/studies/${id}`, undefined, token, labId)).body;
    const save = (method: "POST" | "PUT", body: any, id?: number, legacy = false) =>
      call(method, method === "POST" ? `/api/labs/${labId}/studies` : legacy ? `/api/studies/${id}` : `/api/labs/${labId}/studies/${id}`, body, token, labId);

    // handleSubmit / handleSaveDraft: the body the page sends for the type, from the picker's criterion.
    const critFields = (c: any) => ({
      cliaAllowableError: c.cliaValue, teaIsPercentage: c.teaIsPercentage ? 1 : 0, teaUnit: c.teaUnit,
      cliaAbsoluteFloor: c.cliaAbsoluteFloor, cliaAbsoluteUnit: c.cliaAbsoluteUnit, cliaPresetLabel: c.cliaPresetLabel,
    });
    const body = (studyType: string, testName: string, form: any, c: any, draft = false) => {
      const s = (v: unknown) => JSON.stringify(v);
      const common: any = { testName, instrument: AN, analyst: "Made Up", date: "2026-11-10", studyType, instruments: s([AN]), ...critFields(c),
        status: draft ? "draft" : "pass", createdAt: new Date().toISOString() };
      switch (studyType) {
        case "cal_ver": return { ...common, dataPoints: s(form) };
        case "ref_interval": return { ...common, ...(draft ? {} : { cliaAllowableError: 0.1, teaIsPercentage: 1, teaUnit: "%", cliaAbsoluteFloor: null, cliaAbsoluteUnit: null }), dataPoints: s(lib.buildRefIntervalPayload(form).dataPoints) };
        case "precision": {
          if (draft) return { ...common, ...lib.studyDraftFields("precision", { precision: form }) };
          const p = lib.buildPrecisionPayload(form); return { ...common, dataPoints: s(p.dataPoints), ...p.columns };
        }
        case "lot_to_lot": return { ...common, dataPoints: s(lib.buildLotToLotPayload(form, { draft }).dataPoints) };
        case "linearity": {
          // The levels types store a units preset's unit from their own form, as the page's Run Study does.
          const pct = c.teaIsPercentage;
          return { ...common, teaUnit: pct ? "%" : form.units, cliaAbsoluteFloor: pct ? c.cliaAbsoluteFloor : null, cliaAbsoluteUnit: pct ? c.cliaAbsoluteUnit : null,
            dataPoints: s(lib.buildLevelsPayload("linearity", form, { draft }).dataPoints) };
        }
      }
      throw new Error(studyType);
    };
    const COLS = ["cliaAllowableError", "teaIsPercentage", "teaUnit", "cliaAbsoluteFloor", "cliaAbsoluteUnit", "cliaPresetLabel"] as const;
    const critOf = (row: any) => Object.fromEntries(COLS.map((k) => [k, row?.[k] ?? null]));
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    const diff = (a: unknown, b: unknown) => `want ${JSON.stringify(a)} got ${JSON.stringify(b)}`;
    const rowVerdict = (row: any) => computeStudyStatus(row.studyType, row.dataPoints, row.instruments, row.cliaAllowableError, row.teaIsPercentage !== 0, row.cliaAbsoluteFloor ?? null, row.censoringPolicy ?? "exclude");
    // The criterion the page shows after Edit, in the stored columns' terms (the levels types' value unit is their form's).
    const shownCols = (c: any, studyType: string, row: any) => ({
      cliaAllowableError: c.cliaValue, teaIsPercentage: c.teaIsPercentage ? 1 : 0,
      teaUnit: studyType === "linearity" ? row.teaUnit : c.teaUnit,
      cliaAbsoluteFloor: c.cliaAbsoluteFloor, cliaAbsoluteUnit: c.cliaAbsoluteUnit, cliaPresetLabel: c.cliaPresetLabel,
    });
    const fromPreset = (label: string) => criterion({ ...PAGE_DEFAULT, presetIndex: presetAt(label) });
    const labDefined = (pct: number, floor: number | null, unit: string) => criterion({ ...PAGE_DEFAULT, presetIndex: PRESETS.length - 1, customClia: pct, customAbsFloor: floor, customAbsUnit: unit });

    // ── E + R: save, open Edit, Run Study again ──────────────────────────────────
    type Case = { label: string; studyType: string; form: any; crit: any; wantPicker: string; draft?: boolean };
    const cases: Case[] = [
      { label: "Sodium ±4 mmol/L calibration verification (a 5 mmol/L miss: FAIL)", studyType: "cal_ver", form: grid([[120, 121], [140, 145], [160, 158]]), crit: fromPreset(SODIUM), wantPicker: SODIUM },
      { label: "Sodium ±4 mmol/L precision (units rule)", studyType: "precision", form: precisionForm([[140, 141, 139, 140, 142, 140, 139, 141, 140, 140], [160, 161, 159, 160, 162, 160, 158, 161, 160, 159]]), crit: fromPreset(SODIUM), wantPicker: SODIUM },
      { label: "Sodium ±4 mmol/L lot-to-lot", studyType: "lot_to_lot", form: lotForm(), crit: fromPreset(SODIUM), wantPicker: SODIUM },
      { label: "Glucose ±8% or ±6 mg/dL calibration verification (percent with a floor; 12% high: FAIL)", studyType: "cal_ver", form: grid([[50, 55], [100, 112], [300, 305]]), crit: fromPreset(GLUCOSE), wantPicker: GLUCOSE },
      { label: "Albumin ±8% linearity (percent, no floor)", studyType: "linearity", form: linForm(), crit: fromPreset(ALBUMIN), wantPicker: ALBUMIN },
      { label: "Lab-defined 7% or ±0.3 x10^9/L calibration verification", studyType: "cal_ver", form: grid([[2, 2.25], [5, 5.2], [10, 10.5]]), crit: labDefined(0.07, 0.3, "x10^9/L"), wantPicker: "Custom" },
      { label: "Lab-defined 5% precision (no floor)", studyType: "precision", form: precisionForm([[100, 101, 99, 100, 102, 100, 99, 101, 100, 100]]), crit: labDefined(0.05, null, ""), wantPicker: "Custom" },
      { label: "Sodium ±4 mmol/L precision DRAFT", studyType: "precision", form: precisionForm([[140, 141, 139, 140]]), crit: fromPreset(SODIUM), wantPicker: SODIUM, draft: true },
      { label: "Glucose ±8% or ±6 mg/dL calibration verification DRAFT", studyType: "cal_ver", form: grid([[100, 104], [200, 210]]), crit: fromPreset(GLUCOSE), wantPicker: GLUCOSE, draft: true },
    ];
    for (const k of cases) {
      const post = await save("POST", body(k.studyType, `IT ${k.label}`, k.form, k.crit, k.draft));
      const id = Number(post.body?.id);
      const before = await getRow(id);
      const pick = editPick(before);
      const shown = criterion(pick);
      check(`E1. ${k.label}: Edit's picker shows ${k.wantPicker}`, pickerShows(pick) === k.wantPicker, `shows ${pickerShows(pick)}`);
      check(`E2. ${k.label}: ... and the criterion Edit holds is the saved one`, same(shownCols(shown, k.studyType, before), critOf(before)), diff(critOf(before), shownCols(shown, k.studyType, before)));
      const put = await save("PUT", body(k.studyType, `IT ${k.label}`, k.form, shown, k.draft), id);
      const after = await getRow(id);
      check(`R1. ${k.label}: ${k.draft ? "Save Draft" : "Run Study"} again from Edit keeps the criterion (value, units, floor, label)`, put.status === 200 && same(critOf(after), critOf(before)), `${put.status} ${diff(critOf(before), critOf(after))}`);
      check(`R2. ${k.label}: ... and the stored ${k.draft ? "status" : "verdict"} (${String(before?.status).toUpperCase()}) is unchanged`, after?.status === before?.status, `${before?.status} -> ${after?.status}`);
    }

    // ── Edit holds a saved criterion no preset reproduces, exactly as saved ─────────
    // A labeled row holding a floor its preset doesn't carry (BUG-139's pass left some: Michael decides those), and a
    // row saved before preset labels (2026-06-04) with none.
    const held: Array<[string, any, string]> = [
      ["Albumin ±8% row holding a ±0.3 g/dL floor", { ...fromPreset(ALBUMIN), cliaAbsoluteFloor: 0.3, cliaAbsoluteUnit: "g/dL" }, `As saved: ${ALBUMIN}`],
      ["a row with no preset label (8% or ±6 mg/dL)", { ...fromPreset(GLUCOSE), cliaPresetLabel: null }, "As saved: (no preset label)"],
    ];
    for (const [label, crit, want] of held) {
      const form = grid([[3, 3.25], [4, 4.1], [100, 107]]);
      const post = await save("POST", body("cal_ver", `IT ${label}`, form, crit));
      const id = Number(post.body?.id);
      const before = await getRow(id);
      const pick = editPick(before);
      check(`H1. ${label}: Edit's picker shows the criterion as saved`, pickerShows(pick) === want, `shows ${pickerShows(pick)}`);
      const put = await save("PUT", body("cal_ver", `IT ${label}`, form, criterion(pick)), id);
      const after = await getRow(id);
      check(`H2. ${label}: Run Study again from Edit keeps it exactly, the verdict too`, put.status === 200 && same(critOf(after), critOf(before)) && after.status === before.status,
        `${put.status} ${diff(critOf(before), critOf(after))} ${before?.status}->${after?.status}`);
    }

    // A type whose verdict doesn't use the picker still keeps the label it was saved with.
    const ri = { analyte: "Made-up Sodium", units: "mmol/L", low: 135, high: 145, numSpecimens: 20, data: Array.from({ length: 20 }, (_, i) => ({ specimenId: `S${String(i + 1).padStart(3, "0")}`, value: 136 + (i % 9) })) };
    const riPost = await save("POST", body("ref_interval", "IT reference range labeled Sodium", ri, fromPreset(SODIUM)));
    const riBefore = await getRow(Number(riPost.body?.id));
    const riPick = editPick(riBefore);
    await save("PUT", body("ref_interval", "IT reference range labeled Sodium", ri, criterion(riPick)), riBefore.id);
    const riAfter = await getRow(riBefore.id);
    check("H3. reference range saved with the Sodium label: Edit shows it and a re-run keeps it", pickerShows(riPick) === SODIUM && same(critOf(riAfter), critOf(riBefore)), diff(critOf(riBefore), critOf(riAfter)));

    // ── C: a criterion changed in Edit is saved whole ───────────────────────────────
    const change = async (label: string, studyType: string, form: any, from: any, to: any, opts: { draft?: boolean; legacy?: boolean } = {}) => {
      const post = await save("POST", body(studyType, `IT ${label}`, form, from, opts.draft));
      const id = Number(post.body?.id);
      const put = await save("PUT", body(studyType, `IT ${label}`, form, to, opts.draft), id, opts.legacy);
      const after = await getRow(id);
      const want = shownCols(to, studyType, after);
      check(`C. ${label}: the new criterion is saved whole`, put.status === 200 && same(critOf(after), want), `${put.status} ${diff(want, critOf(after))}`);
      if (!opts.draft) check(`C. ${label}: ... and the stored verdict is the one its own saved criterion gives`, after.status === rowVerdict(after), `stored ${after.status} row gives ${rowVerdict(after)}`);
      return after;
    };
    const sodiumGrid = grid([[120, 121], [140, 143], [160, 158]]);
    await change("Glucose to Sodium (percent with floor to units), calibration verification", "cal_ver", sodiumGrid, fromPreset(GLUCOSE), fromPreset(SODIUM));
    await change("Sodium to Glucose (units to percent with floor), precision", "precision", precisionForm([[140, 141, 139, 140, 142, 140, 139, 141, 140, 140]]), fromPreset(SODIUM), fromPreset(GLUCOSE));
    await change("Lab-defined floor changed (7% or ±0.3 x10^9/L to 12% or ±0.5 mmol/L)", "cal_ver", grid([[2, 2.25], [5, 5.2], [10, 10.5]]), labDefined(0.07, 0.3, "x10^9/L"), labDefined(0.12, 0.5, "mmol/L"));
    await change("Lab-defined floor removed", "cal_ver", grid([[2, 2.25], [5, 5.2], [10, 10.5]]), labDefined(0.07, 0.3, "x10^9/L"), labDefined(0.07, null, ""));
    await change("ALT to Sodium in a DRAFT re-save", "lot_to_lot", lotForm(), fromPreset(ALT), fromPreset(SODIUM), { draft: true });
    await change("Glucose to Sodium through the older PUT /api/studies/:id", "cal_ver", sodiumGrid, fromPreset(GLUCOSE), fromPreset(SODIUM), { legacy: true });
    await change("Sodium draft to Glucose through the older PUT /api/studies/:id", "cal_ver", sodiumGrid, fromPreset(SODIUM), fromPreset(GLUCOSE), { draft: true, legacy: true });

    // ── K: a body without the criterion fields leaves them as they were ─────────────
    const kPost = await save("POST", body("cal_ver", "IT draft keep criterion", sodiumGrid, fromPreset(SODIUM), true));
    const kId = Number(kPost.body?.id);
    const kBefore = await getRow(kId);
    for (const legacy of [false, true]) {
      await save("PUT", { testName: "IT draft keep criterion (renamed)", studyType: "cal_ver", status: "draft" }, kId, legacy);
      const kAfter = await getRow(kId);
      check(`K. a draft PUT that sends only a new name (${legacy ? "older" : "lab"} route) keeps the criterion and its label`, same(critOf(kAfter), critOf(kBefore)), diff(critOf(kBefore), critOf(kAfter)));
    }
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
