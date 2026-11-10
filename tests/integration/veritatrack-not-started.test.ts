// tests/integration/veritatrack-not-started.test.ts
//
// STANDING integration test for BUG-143 (2026-11-10): a VeritaTrack task with no live sign-off counted as Overdue in the
// Today's Worklist tile while both dashboard routes counted it as notStarted (and the page showed no card for that), so a
// lab with one new task read "Overdue 1" above cards that counted it nowhere. Now the worklist counts it as not_started, and
// for every task the worklist and the two dashboards agree on overdue and not started.
//   1. One new task, no sign-off: worklist not_started 1, overdue 0; both dashboards notStarted 1, overdue 0.
//   2. A task signed off long ago (past due): overdue 1 in the worklist and both dashboards.
//   3. A task whose only sign-off is voided reads not started again in all three.
//   4. A task signed off today (current): in neither overdue nor not started.
//   5. Every active task is counted in exactly one dashboard bucket (total = sum), and the worklist's overdue + not started
//      equal the dashboards' overdue + notStarted.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Nothing is mailed.
// Run: npm run test:veritatrack-not-started

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  delete process.env.RESEND_API_KEY;
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const PW = ["Not", "started", "143!"].join("-");
  const email = `it-vtns-owner-${Date.now()}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Olive Notstarted", hipaa_acknowledged: true });
  const userId = Number(reg.body?.user?.id);
  const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "placeholder", plan: "hospital" })).body?.labId);
  sqlite.prepare("UPDATE labs SET clia_number = '22D7781430', lab_name = 'IT Not Started Lab' WHERE id = ?").run(labId);
  sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
  const token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;

  const newTask = async (name: string, frequency = "Monthly") => (await call("POST", `/api/labs/${labId}/veritatrack/tasks`, { name, category: "QC Review", frequency }, token, labId)).body;
  const signOff = async (taskId: number, completed_date: string) => (await call("POST", `/api/veritatrack/tasks/${taskId}/signoff`, { completed_date, performed_by: "Pat Example", initials: "PE" }, token, labId)).body;
  const views = async () => {
    const w = (await call("GET", `/api/labs/${labId}/veritatrack/worklist`, undefined, token, labId)).body;
    const d = (await call("GET", `/api/labs/${labId}/veritatrack/dashboard`, undefined, token, labId)).body;
    const legacy = (await call("GET", "/api/veritatrack/dashboard", undefined, token, labId)).body;
    return { w, d, legacy };
  };
  const today = (await views()).w?.today as string;

  try {
    // 1. One new task, no sign-off
    const a = await newTask("Made-up monthly QC review");
    check("1. setup: one task", Number.isInteger(a?.id));
    let v = await views();
    check("1. worklist: the new task is Not Started, not Overdue", v.w?.counts?.not_started === 1 && v.w?.counts?.overdue === 0 && v.w?.buckets?.not_started?.[0]?.id === a.id && v.w?.buckets?.overdue?.length === 0, JSON.stringify(v.w?.counts));
    check("1. lab dashboard: notStarted 1, overdue 0", v.d?.notStarted === 1 && v.d?.overdue === 0, JSON.stringify({ ns: v.d?.notStarted, od: v.d?.overdue }));
    check("1. legacy dashboard: notStarted 1, overdue 0", v.legacy?.notStarted === 1 && v.legacy?.overdue === 0, JSON.stringify({ ns: v.legacy?.notStarted, od: v.legacy?.overdue }));

    // 2. A task signed off long ago
    const b = await newTask("Made-up monthly maintenance review");
    await signOff(b.id, "2025-01-15");
    v = await views();
    check("2. a task last signed off in January 2025 is Overdue in all three", v.w?.counts?.overdue === 1 && v.d?.overdue === 1 && v.legacy?.overdue === 1 && v.w?.buckets?.overdue?.[0]?.id === b.id, JSON.stringify({ w: v.w?.counts?.overdue, d: v.d?.overdue, l: v.legacy?.overdue }));
    check("2. ... and Not Started is still the one new task", v.w?.counts?.not_started === 1 && v.d?.notStarted === 1);

    // 3. A task whose only sign-off is voided
    const c = await newTask("Made-up quarterly review", "Quarterly");
    const cs = await signOff(c.id, today);
    const voided = await call("POST", `/api/veritatrack/signoffs/${cs.id}/void`, { reason: "Entered on the wrong task (made-up)" }, token, labId);
    check("3. setup: the only sign-off is voided", voided.status === 200, `HTTP ${voided.status}`);
    v = await views();
    check("3. a task whose only sign-off is voided reads Not Started in all three", v.w?.counts?.not_started === 2 && v.d?.notStarted === 2 && v.legacy?.notStarted === 2 && v.w?.buckets?.not_started?.some((t: any) => t.id === c.id), JSON.stringify({ w: v.w?.counts, d: v.d?.notStarted }));

    // 4. A task signed off today
    const e = await newTask("Made-up annual review", "Annual");
    await signOff(e.id, today);
    v = await views();
    check("4. a task signed off today is in neither Overdue nor Not Started", v.w?.counts?.overdue === 1 && v.w?.counts?.not_started === 2 && v.d?.current >= 1 && !v.w?.buckets?.not_started?.some((t: any) => t.id === e.id) && !v.w?.buckets?.overdue?.some((t: any) => t.id === e.id), JSON.stringify({ w: v.w?.counts, d: { od: v.d?.overdue, cur: v.d?.current } }));

    // 5. Every task in exactly one dashboard bucket; the worklist and the dashboards agree
    for (const [label, d] of [["lab dashboard", v.d], ["legacy dashboard", v.legacy]] as const) {
      check(`5. ${label}: every active task is counted once (total = overdue + due this month + due soon + current + not started)`,
        d?.total === 4 && d.overdue + d.dueThisMonth + d.dueSoon + d.current + d.notStarted === d.total, JSON.stringify(d && { total: d.total, od: d.overdue, m: d.dueThisMonth, s: d.dueSoon, c: d.current, ns: d.notStarted }));
    }
    check("5. the worklist's Overdue and Not Started equal the dashboards'", v.w?.counts?.overdue === v.d?.overdue && v.w?.counts?.not_started === v.d?.notStarted && v.d?.overdue === v.legacy?.overdue && v.d?.notStarted === v.legacy?.notStarted);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
