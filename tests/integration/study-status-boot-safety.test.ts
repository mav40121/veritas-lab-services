// tests/integration/study-status-boot-safety.test.ts
//
// Receipt for parking-lot #69 (2026-10-07). Production logged, on EVERY boot,
// four "[computeStudyStatus] Error recomputing status: TypeError: Cannot read
// properties of undefined (reading 'Beckman AU5800 Primary vs ...')" lines:
// legacy studies #43-#46 store `instruments` as a bare string and their points
// as {x,y} with no instrumentValues. computeStudyStatus returns "fail" on any
// exception and recomputeAllStudyStatuses() wrote that fail-safe back as a
// verdict. This boots the REAL module against a throwaway SQLite DB (DB_PATH
// from the runner), inserts the shapes that broke, and proves:
//   1. a legacy row (bare-string instruments, {x,y} points, stored "pass") is
//      left alone: no throw, status unchanged, counted as skipped
//   2. a method-comparison row with one point missing instrumentValues is
//      evaluated from its other points without throwing
//   3. a genuinely failing method comparison still flips to "fail" (the
//      recompute still does its job)
//   4. a second boot changes nothing (idempotent)
//
// Run: npm run test:study-status-boot
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { recomputeAllStudyStatuses } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const now = new Date().toISOString();
  const ins = sqlite.prepare(
    `INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, tea_is_percentage, tea_unit, data_points, instruments, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'method_comparison', ?, 1, '%', ?, ?, ?, ?)`
  );

  // 1. legacy row: bare-string instruments + {x,y} points, stored "pass"
  const legacy = Number(ins.run(1, "Sodium", "Beckman AU5800", "legacy", "2026-01-01", 0.04,
    JSON.stringify([{ x: 132, y: 133 }, { x: 138, y: 139 }, { x: 141, y: 140 }]),
    "Beckman AU5800 Primary vs Beckman AU5800 Backup", "pass", now).lastInsertRowid);

  // 2. valid MC row with one point missing instrumentValues; others all within 4%
  const P = "Sysmex XN-1000 [Primary]", C = "Sysmex XN-2000 [Backup]";
  const goodPts = [[13.2, 13.4], [12.1, 12.0], [14.8, 14.9]].map(([a, b], i) => ({ level: i + 1, expectedValue: null, instrumentValues: { [P]: a, [C]: b } }));
  const mixed = Number(ins.run(1, "Hemoglobin", "Sysmex XN-1000", "qa", "2026-01-02", 0.04,
    JSON.stringify([{ level: 0, expectedValue: null }, ...goodPts]),
    JSON.stringify([P, C]), "completed", now).lastInsertRowid);

  // 3. genuinely failing MC row (one pair 10% apart on a 4% TEa), stored "pass" by mistake
  const badPts = [[13.2, 13.4], [12.0, 13.2], [14.8, 14.9]].map(([a, b], i) => ({ level: i + 1, expectedValue: null, instrumentValues: { [P]: a, [C]: b } }));
  const failing = Number(ins.run(1, "Hemoglobin", "Sysmex XN-1000", "qa", "2026-01-03", 0.04,
    JSON.stringify(badPts), JSON.stringify([P, C]), "pass", now).lastInsertRowid);

  const status = (id: number) => (sqlite.prepare("SELECT status FROM studies WHERE id = ?").get(id) as any)?.status;

  let threw: any = null;
  let r1: any = null;
  try { r1 = recomputeAllStudyStatuses(); } catch (e) { threw = e; }
  check("boot recompute does not throw on the legacy shape", threw === null, String(threw?.message || ""));
  check("legacy row is SKIPPED, not failed (status unchanged)", status(legacy) === "pass", `status=${status(legacy)}`);
  check("skipped counter reports the legacy row", (r1?.skipped ?? 0) >= 1, JSON.stringify(r1));
  check("MC row with a malformed point evaluates from the rest -> pass", status(mixed) === "pass", `status=${status(mixed)}`);
  check("genuinely failing MC row still flips to fail", status(failing) === "fail", `status=${status(failing)}`);

  // 4. idempotent second boot
  const before = [legacy, mixed, failing].map(status).join(",");
  const r2 = recomputeAllStudyStatuses();
  const after = [legacy, mixed, failing].map(status).join(",");
  check("second boot changes nothing", before === after && r2.fixed === 0, `${before} -> ${after}; fixed=${r2.fixed}`);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
