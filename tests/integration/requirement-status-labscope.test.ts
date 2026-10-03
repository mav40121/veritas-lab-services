// tests/integration/requirement-status-labscope.test.ts
//
// Receipt for the veritapolicy_requirement_status cross-lab fix (Phase 3.3b).
// Boots the real routes on a throwaway DB (so the boot migration runs), seeds ONE owner
// with TWO labs, and proves a requirement edit on lab A does NOT leak into / overwrite
// lab B (the stale UNIQUE(user_id, requirement_id) made them share one row).
//
// Run: DB_PATH=.tmp-reqscope.db JWT_SECRET=t ADMIN_SECRET=localadmin STRIPE_SECRET_KEY=sk_test_dummy \
//   STRIPE_WEBHOOK_SECRET=whsec_dummy tsx tests/integration/requirement-status-labscope.test.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
(globalThis as any).require ??= createRequire(import.meta.url);

let fail = 0;
const check = (name: string, cond: boolean, d = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${d ? " :: " + d : ""}`); if (!cond) fail++; };
const sqlite = (db as any).$client;

async function main() {
  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port; const base = `http://127.0.0.1:${port}`;

  // 1. Migration ran: the table's unique key is now (lab_id, requirement_id).
  const tblSql = (sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='veritapolicy_requirement_status'").get() as any)?.sql || "";
  check("migration rebuilt UNIQUE(lab_id, requirement_id)", /UNIQUE\s*\(\s*lab_id\s*,\s*requirement_id\s*\)/i.test(tblSql), tblSql.replace(/\s+/g, " ").slice(0, 120));
  check("old UNIQUE(user_id, requirement_id) gone", !/UNIQUE\s*\(\s*user_id\s*,\s*requirement_id\s*\)/i.test(tblSql));

  // 2. Seed one owner + two labs.
  const prov = await (await fetch(base + "/api/admin/provision-owner-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: "localadmin", ownerEmail: "o@qa.test", ownerName: "O", labName: "Lab A", cliaNumber: "22D0000A01", plan: "enterprise" }) })).json();
  const ownerId = prov.owner_user_id, labA = prov.lab_id;
  const now = new Date().toISOString();
  const labB = Number(sqlite.prepare("INSERT INTO labs (clia_number, lab_name, owner_user_id, plan, subscription_status, created_at, updated_at) VALUES (?,?,?,?,'active',?,?)").run("22D0000B02", "Lab B", ownerId, "enterprise", now, now).lastInsertRowid);
  sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,'owner','active',0,?,?,?)").run(labB, ownerId, now, now, now);
  const token = jwt.sign({ userId: ownerId }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  const patch = (labId: number, status: string) => fetch(base + `/api/veritapolicy/requirements/5`, { method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) }, body: JSON.stringify({ status }) });
  const readReq5 = (labId: number) => fetch(base + `/api/veritapolicy/requirements`, { headers: { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId) } }).then((r) => r.json());

  // 3. Edit requirement 5 differently on each lab.
  await patch(labA, "complete");
  await patch(labB, "not_started");

  // 4. Each lab keeps its own value (no cross-contamination).
  const rowsA = sqlite.prepare("SELECT lab_id, status FROM veritapolicy_requirement_status WHERE requirement_id=5 ORDER BY lab_id").all() as any[];
  check("two separate rows, one per lab", rowsA.length === 2, JSON.stringify(rowsA));
  const aRow = rowsA.find((r) => r.lab_id === labA), bRow = rowsA.find((r) => r.lab_id === labB);
  check(`lab A row = complete`, aRow?.status === "complete", JSON.stringify(aRow));
  check(`lab B row = not_started`, bRow?.status === "not_started", JSON.stringify(bRow));

  server.close();
  console.log(`\nTOTAL: ${fail === 0 ? "ALL PASS" : fail + " FAILED"}`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
