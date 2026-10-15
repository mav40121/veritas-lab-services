// tests/integration/veritatrack-competency-annual.test.ts
//
// Receipt for BUG-028 (2026-10-11). The VeritaTrack worklist lists a competency milestone due within 30 days
// that is not done. annual_due_at is always the NEXT annual (every save figures it from the latest completion),
// but the annual row treated last_annual_completed_at (the PREVIOUS annual) as "done", so once a person had any
// annual on file, their next annual never appeared. Boots the REAL routes on a scratch DB and proves:
//   1. annual due in 9 days after a 1st annual on file: listed (unchanged)
//   2. annual due in 9 days after a previous ANNUAL on file: listed (the fix)
//   3. a stale annual due date with an annual recorded on/after it: not listed (still counts as done)
// Run (from bash): DB_PATH=.tmp-trk.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritatrack-competency-annual.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const app = express(); app.use(express.json());
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address(); const base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  const call = async (m: string, p: string, b?: unknown, t?: string) => { const r = await fetch(base + p, { method: m, headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }); let j: any = {}; try { j = await r.json(); } catch {} return { s: r.status, j }; };
  const email = `trk-${Date.now()}@example.com`;
  const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Track Test", hipaa_acknowledged: true })).j;
  const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET || "test-admin-secret", ownerEmail: email, labName: "Track Test Lab", plan: "hospital" })).j.labId;
  const L = `/api/labs/${labId}`;
  await call("POST", `${L}/staff/lab`, { labName: "Track Test Lab", cliaNumber: "11D7654326", accreditationBody: "CLIA_ONLY", complexity: "high" }, reg.token);
  const mk = async (f: string) => (await call("POST", `${L}/staff/employees`, { lastName: "Track", firstName: f, highestComplexity: "H", performsTesting: true, hireDate: "2015-01-01" }, reg.token)).j.id;
  const firstAnnual = await mk("FirstAnnual"), lastAnnual = await mk("LastAnnual"), stale = await mk("Stale");
  const d = new Date(); d.setDate(d.getDate() + 9); d.setFullYear(d.getFullYear() - 1);
  const done = d.toISOString().slice(0, 10); // a year ago + 9 days, so the next annual is due in 9 days
  await call("PUT", `${L}/staff/competency/${firstAnnual}`, { initialCompletedAt: "2015-02-01", sixMonthCompletedAt: "2015-08-01", firstAnnualCompletedAt: done }, reg.token);
  await call("PUT", `${L}/staff/competency/${lastAnnual}`, { initialCompletedAt: "2015-02-01", sixMonthCompletedAt: "2015-08-01", firstAnnualCompletedAt: "2016-02-01", lastAnnualCompletedAt: done }, reg.token);
  // Stale row: an annual due date in 9 days with an annual already recorded after it (as an old seed could leave).
  await call("PUT", `${L}/staff/competency/${stale}`, { initialCompletedAt: "2015-02-01", sixMonthCompletedAt: "2015-08-01", firstAnnualCompletedAt: "2016-02-01", lastAnnualCompletedAt: done }, reg.token);
  const soon = new Date(); soon.setDate(soon.getDate() + 9);
  const later = new Date(); later.setDate(later.getDate() + 12);
  sqlite.prepare("UPDATE staff_competency_schedules SET annual_due_at = ?, last_annual_completed_at = ? WHERE employee_id = ?").run(soon.toISOString().slice(0, 10), later.toISOString().slice(0, 10), stale);

  const wl = await call("GET", `${L}/veritatrack/worklist`, undefined, reg.token);
  const comp: string[] = (wl.j.cross_module || []).filter((x: any) => x.source === "veritacomp").map((x: any) => `${x.label} (${x.due_date})`);
  check("worklist responds", wl.s === 200, String(wl.s));
  check("1. annual due in 9 days after a 1st annual on file: listed", comp.some((c) => /annual due: Track, FirstAnnual/.test(c)), JSON.stringify(comp));
  check("2. annual due in 9 days after a previous annual on file: listed (BUG-028)", comp.some((c) => /annual due: Track, LastAnnual/.test(c)), JSON.stringify(comp));
  check("3. stale annual due date with an annual recorded on/after it: not listed", !comp.some((c) => /Track, Stale/.test(c)), JSON.stringify(comp));

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
