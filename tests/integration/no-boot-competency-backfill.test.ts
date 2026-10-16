// tests/integration/no-boot-competency-backfill.test.ts
//
// BUG-068 (2026-10-16): registerRoutes ran a "demo competency data backfill" on every start that filled blank
// element fields in EVERY lab's competency_assessment_items with made-up evidence (specimen 0326:C147
// observed by MV, a sodium result, PT sample CAP-2026-C-01, quiz Q-AU5800-001 scored 100).
// Pins:
//   1. a client lab's blank competency elements are still blank after the server starts again
//   2. element data the lab did enter (observer initials, a quiz score) is left exactly as entered
//   3. no startup file writes the made-up values with an UPDATE
// Run: npm run test:no-boot-competency-backfill

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function boot() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  return server;
}

async function main() {
  const first = await boot();
  const sqlite = (db as any).$client;
  const now = new Date().toISOString();

  // A client lab's competency record, entered after the first start: one element left blank everywhere,
  // one with only observer initials and a quiz score entered.
  const owner = Number(sqlite.prepare("INSERT INTO users (email, password_hash, name, plan, created_at) VALUES (?, 'x', 'Owner', 'hospital', ?)").run(`it-backfill-${Date.now()}@example.com`, now).lastInsertRowid);
  const lab = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id, plan, created_at, updated_at) VALUES ('IT Backfill Lab', '99D9999999', ?, 'hospital', ?, ?)").run(owner, now, now).lastInsertRowid);
  const prog = Number(sqlite.prepare("INSERT INTO competency_programs (user_id, name, type, lab_id, created_at, updated_at) VALUES (?, 'Chemistry', 'technical', ?, ?, ?)").run(owner, lab, now, now).lastInsertRowid);
  const emp = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, name, status, lab_id, created_at) VALUES (?, 'Pat Tech', 'active', ?, ?)").run(owner, lab, now).lastInsertRowid);
  const asmt = Number(sqlite.prepare("INSERT INTO competency_assessments (program_id, employee_id, assessment_type, assessment_date, status, created_at) VALUES (?, ?, 'initial', ?, 'draft', ?)").run(prog, emp, now.slice(0, 10), now).lastInsertRowid);
  const blank = Number(sqlite.prepare("INSERT INTO competency_assessment_items (assessment_id, method_number, element_number) VALUES (?, 1, 1)").run(asmt).lastInsertRowid);
  const partial = Number(sqlite.prepare("INSERT INTO competency_assessment_items (assessment_id, method_number, element_number, el1_observer_initials, el6_score, el6_date_taken) VALUES (?, 1, 1, 'JQ', 85, '2026-10-01')").run(asmt).lastInsertRowid);

  // The server starts again (a deploy).
  const second = await boot();

  const read = (id: number) => sqlite.prepare("SELECT el1_specimen_id, el1_observer_initials, el2_evidence, el2_date, el5_sample_type, el5_sample_id, el5_acceptable, el6_quiz_id, el6_score, el6_date_taken FROM competency_assessment_items WHERE id = ?").get(id) as any;
  const b = read(blank);
  const filled = Object.entries(b).filter(([, v]) => v !== null && v !== "").map(([k, v]) => `${k}=${v}`);
  check("1. blank elements stay blank after a restart", filled.length === 0, filled.join(", ") || "all blank");

  const p = read(partial);
  check("2a. observer initials the lab entered are unchanged", p.el1_observer_initials === "JQ", String(p.el1_observer_initials));
  check("2b. quiz score and date the lab entered are unchanged", Number(p.el6_score) === 85 && p.el6_date_taken === "2026-10-01", `${p.el6_score} ${p.el6_date_taken}`);
  check("2c. no made-up specimen, PT sample or quiz id added", !p.el1_specimen_id && !p.el5_sample_id && !p.el6_quiz_id, JSON.stringify(p));

  // 3) source guard: no startup file UPDATEs a row to one of the made-up values
  const MADE_UP = ["0326:C147", "CAP-2026-C-01", "Q-AU5800-001"];
  const offenders: string[] = [];
  for (const f of ["server/routes.ts", "server/db.ts", "server/index.ts"]) {
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..", f), "utf-8");
    for (const stmt of src.match(/UPDATE\s+\w+\s+SET[^`"]*/g) || []) {
      if (MADE_UP.some((v) => stmt.includes(v))) offenders.push(`${f}: ${stmt.slice(0, 80)}`);
    }
  }
  check("3. no startup UPDATE writes the made-up values", offenders.length === 0, offenders.join(" | ") || "none");

  first.close();
  second.close();
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
