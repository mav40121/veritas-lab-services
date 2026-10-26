// tests/integration/finding-reminder-qc.test.ts
//
// STANDING integration test for parking lot #99 (2026-10-26): a VeritaResponse reminder for a finding that VeritaQC
// escalated names the QC test, control level, lot, run date and instrument (server/audit.ts
// findingReminderCandidates + findingReminderEmail). An ordinary finding's reminder is unchanged; two corrective
// actions stamped with the same finding give one reminder row, not two; no em dashes.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:finding-reminder-qc

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { findingReminderCandidates, findingReminderEmail } from "../../server/audit";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const post = async (p: string, body: unknown) => (await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json() as any;

  try {
    const email = `it-remind-${Date.now()}@example.com`;
    const reg = await post("/api/auth/register", { email, password: ["Fr", "q1", "7x!"].join("-"), name: "IT Reminder", hipaa_acknowledged: true });
    const userId = Number(reg?.user?.id);
    const labId = Number((await post("/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Reminder Lab", plan: "hospital" })).labId);
    check("0. lab made", userId > 0 && labId > 0, JSON.stringify([userId, labId]));

    const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const lot = Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd) VALUES (?, 'Glucose', 'Level 2', 'BR-4471', 100, 3)").run(labId).lastInsertRowid);
    const run = Number(sqlite.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, instrument) VALUES (?, ?, 112, '2026-10-12', 'Analyzer A')").run(labId, lot).lastInsertRowid);
    const addFinding = (num: string) => Number(sqlite.prepare(
      "INSERT INTO findings (user_id, lab_id, accreditor, finding_number, standard_ref, due_date, status) VALUES (?, ?, 'CMS', ?, '42 CFR 493.1282', ?, 'open')"
    ).run(userId, labId, num, due).lastInsertRowid);
    const fQc = addFinding("QC-1-3s");
    const fPlain = addFinding("CHM.12345");
    for (let i = 0; i < 2; i++) {
      sqlite.prepare("INSERT INTO qc_corrective_actions (lab_id, qc_result_id, action_taken, taken_by_user_id, nce_reference) VALUES (?, ?, 'Reran control', ?, ?)").run(labId, run, userId, `VeritaResponse#${fQc}`);
    }

    const rows = findingReminderCandidates(sqlite).filter((r: any) => r.id === fQc || r.id === fPlain);
    const qcRows = rows.filter((r: any) => r.id === fQc);
    const qc = qcRows[0];
    const plain = rows.find((r: any) => r.id === fPlain);
    check("1. the escalated finding comes back once, with its QC run", qcRows.length === 1 && qc?.qc_analyte === "Glucose" && qc?.qc_level === "Level 2" && qc?.qc_lot === "BR-4471" && qc?.qc_run_date === "2026-10-12" && qc?.qc_instrument === "Analyzer A", JSON.stringify(qcRows));
    check("2. an ordinary finding has no QC fields", !!plain && plain.qc_analyte == null, JSON.stringify(plain));

    const e1 = findingReminderEmail(qc, 7);
    check("3a. the QC reminder's subject names the test and level", e1.subject === "VeritaResponse reminder: Glucose, Level 2 QC finding QC-1-3s due in 7 days", e1.subject);
    check("3b. the body names test, level, lot, run date and instrument",
      ["QC test: Glucose", "Control level: Level 2", "Control lot: BR-4471", "QC run date: 2026-10-12", "Instrument: Analyzer A"].every((l) => e1.text.includes(l)), e1.text);
    const e2 = findingReminderEmail(plain, 1);
    check("4. an ordinary reminder keeps its old subject and has no QC lines", e2.subject === "VeritaResponse reminder: finding CHM.12345 due in 1 day" && !e2.text.includes("QC test:"), e2.subject);
    check("5. no em dashes in either email", ![e1.subject, e1.text, e2.subject, e2.text].some((t) => t.includes("—")));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
