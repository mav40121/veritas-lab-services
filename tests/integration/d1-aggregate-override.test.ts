// tests/integration/d1-aggregate-override.test.ts
//
// Receipt for parking-lot #67 (2026-10-07): can a VeritaCheck method-comparison
// study FAIL on the aggregate mean |bias| guard (server/routes.ts ~424-451) while
// EVERY sample passes the per-sample criterion? Michael: "If every sample has to
// be a pass, it is not possible for the aggregate to be a fail."
//
// Exercises the REAL engine (computeStudyStatus via recomputeAllStudyStatuses on
// inserted rows, same pattern as study-status-boot-safety.test.ts) and proves:
//   A. percent-only TEa: all samples pass -> engine keeps "pass" (the guard is a
//      no-op; mean of values each <= T is <= T). A 20,000-case random search over
//      the same formulas finds no counter-example.
//   B. absolute-only TEa: same, no-op.
//   C. DUAL-criterion TEa (percent OR absolute floor, e.g. Glucose 8% or 6 mg/dL):
//      every sample passes (low levels pass via the floor) yet the engine flips the
//      stored "pass" to "fail", because the guard averages FRACTIONAL biases
//      (inflated by the floor-passed low samples) and compares them to the percent
//      TEa with the floor converted at the MEAN reference. That is the only case
//      where Michael's statement is violated, and it is the guard mixing criteria,
//      not a data problem.
//   D. the same dual-criterion data with a genuinely failing sample still fails
//      (the per-sample rule is doing its job either way).
//
// No code change: this is the evidence for Michael's regulatory call on the guard.
// Run: DB_PATH=.tmp-d1.db JWT_SECRET=x ADMIN_SECRET=x STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/d1-aggregate-override.test.ts
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// Replica of the per-sample + aggregate formulas (routes.ts 395-451) for the random search only.
function replica(pts: Array<[number, number]>, tea: number, isPct: boolean, floor: number | null) {
  let pass = 0; const bias: number[] = []; const refs: number[] = [];
  for (const [ref, v] of pts) {
    const diff = v - ref;
    const pctAllow = isPct ? Math.abs(ref) * tea : 0;
    const absAllow = isPct ? (floor ?? 0) : tea;
    if (Math.abs(diff) <= Math.max(pctAllow, absAllow) + 1e-9) pass++;
    bias.push(isPct ? (ref !== 0 ? diff / ref : 0) : diff); refs.push(ref);
  }
  const perSample = pass === pts.length ? "pass" : "fail";
  const meanAbs = bias.reduce((a, b) => a + Math.abs(b), 0) / bias.length;
  const meanRef = refs.reduce((a, b) => a + Math.abs(b), 0) / refs.length;
  const meanAllow = isPct ? Math.max(tea, (floor ?? 0) / (meanRef || 1)) : tea;
  const override = perSample === "pass" && meanAbs > meanAllow + 1e-9;
  return { perSample, meanAbs, meanAllow, override };
}

async function main() {
  const { db } = await import("../../server/db");
  const { recomputeAllStudyStatuses } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const now = new Date().toISOString();
  const P = "Roche cobas c 503 [Primary]", C = "Roche cobas c 303 [Backup]";
  const ins = sqlite.prepare(
    `INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, clia_absolute_floor, data_points, instruments, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'method_comparison', ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const mk = (name: string, tea: number, isPct: boolean, floor: number | null, pairs: Array<[number, number]>, stored: string) =>
    Number(ins.run(1, name, "Roche cobas c 503", "qa", "2026-10-07", tea, isPct ? 1 : 0, isPct ? "%" : "mg/dL", floor,
      JSON.stringify(pairs.map(([ref, v], i) => ({ level: i + 1, expectedValue: ref, instrumentValues: { [P]: ref, [C]: v } }))),
      JSON.stringify([P, C]), stored, now).lastInsertRowid);
  const status = (id: number) => (sqlite.prepare("SELECT status FROM studies WHERE id = ?").get(id) as any)?.status;

  // A. percent-only (Sodium-like 4%): every pair within 4%
  const a = mk("Sodium", 0.04, true, null, [[132, 135], [138, 141], [141, 144], [150, 155]], "pass");
  // B. absolute-only (Calcium 1.0 mg/dL): every pair within 1.0
  const b = mk("Calcium", 1.0, false, null, [[8.0, 8.9], [9.5, 10.4], [11.0, 11.9]], "pass");
  // C. dual criterion (Glucose 8% or 6 mg/dL): low levels pass by the FLOOR, high level by the percent
  const cPairs: Array<[number, number]> = [[40, 46], [50, 56], [300, 320]];
  const c = mk("Glucose", 0.08, true, 6, cPairs, "pass");
  // D. dual criterion with a genuinely failing pair (ref 40 -> 47 is +7 mg/dL > 6 floor and 17.5% > 8%)
  const d = mk("Glucose", 0.08, true, 6, [[40, 47], [50, 56], [300, 320]], "pass");

  const r = recomputeAllStudyStatuses();
  console.log("recompute:", JSON.stringify(r));

  check("A percent-only, all samples pass: engine keeps pass", status(a) === "pass", `status=${status(a)}`);
  check("B absolute-only, all samples pass: engine keeps pass", status(b) === "pass", `status=${status(b)}`);
  const rc = replica(cPairs, 0.08, true, 6);
  check("C dual-criterion: every sample passes per-sample (replica)", rc.perSample === "pass", JSON.stringify(rc));
  check("C dual-criterion: aggregate guard overrides to FAIL in the real engine", status(c) === "fail",
    `status=${status(c)}; mean|bias|=${(rc.meanAbs * 100).toFixed(2)}% vs guard allowance ${(rc.meanAllow * 100).toFixed(2)}%`);
  check("D dual-criterion with a real failing sample: fail (per-sample rule)", status(d) === "fail", `status=${status(d)}`);

  // Random search: single-criterion cases can never trigger the override.
  let hits = 0, tried = 0;
  for (let i = 0; i < 20000; i++) {
    const isPct = i % 2 === 0; const tea = isPct ? 0.02 + Math.random() * 0.2 : 0.2 + Math.random() * 2;
    const n = 3 + Math.floor(Math.random() * 10);
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const ref = 1 + Math.random() * 300;
      const allow = isPct ? ref * tea : tea;
      pts.push([ref, ref + (Math.random() * 2 - 1) * allow]); // within allowance by construction
    }
    const rr = replica(pts, tea, isPct, null); tried++;
    if (rr.override) hits++;
  }
  check(`random search: 0 single-criterion counter-examples in ${tried} all-pass datasets`, hits === 0, `hits=${hits}`);

  // Random search: dual-criterion override frequency when every sample passes.
  let dualHits = 0, dualTried = 0;
  for (let i = 0; i < 20000; i++) {
    const tea = 0.05 + Math.random() * 0.1, floor = 2 + Math.random() * 8;
    const n = 3 + Math.floor(Math.random() * 6);
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < n; k++) {
      const ref = 10 + Math.random() * 300;
      const allow = Math.max(ref * tea, floor);
      pts.push([ref, ref + (Math.random() * 2 - 1) * allow]);
    }
    const rr = replica(pts, tea, true, floor); dualTried++;
    if (rr.override) dualHits++;
  }
  console.log(`info: dual-criterion all-pass datasets overridden to FAIL by the guard: ${dualHits} of ${dualTried} (${(100 * dualHits / dualTried).toFixed(1)}%)`);
  check("dual-criterion random search finds at least one override (the defect class exists)", dualHits > 0);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
