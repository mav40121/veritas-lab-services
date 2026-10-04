// scripts/verify-md-delegation-gates.ts
//
// Gate 3 receipt for item-5 Phase 2 (MD-or-designee access gates on QC co-sign + finding
// closure). Boots the real routes on a throwaway DB, seeds a designated MD, a TS designee,
// a TC designee, a plain member, an admin and the owner, plus VeritaMap complexity, QC
// control lots and a finding, then asserts who may attest. No production data.
//
// Run:
//   DB_PATH=.tmp-verify-ddg.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin \
//   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy \
//   node_modules/.bin/tsx scripts/verify-md-delegation-gates.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { storage } from "../server/storage";
(globalThis as any).require ??= createRequire(import.meta.url);

const SECRET = process.env.JWT_SECRET!;
const sqlite = (db as any).$client;
const now = new Date().toISOString();
let fails = 0;
const check = (label: string, ok: boolean, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  (" + detail + ")" : ""}`); if (!ok) fails++; };

// CHECK-aware, FK-off generic row seeder (same approach as the inventory sweep harness).
const checkFirstAllowed = (sql: string, name: string): string | null => {
  const m = sql.match(new RegExp("CHECK\\s*\\(\\s*\"?" + name + "\"?\\s+IN\\s*\\(([^)]*)\\)", "i"));
  if (!m) return null;
  return m[1].split(",")[0].trim().replace(/^['"]|['"]$/g, "");
};
function seedRow(table: string, overrides: Record<string, any>) {
  const meta = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as any;
  if (!meta) { console.log(`[seed] ${table}: no such table`); return; }
  const cols = sqlite.prepare(`PRAGMA table_info("${table}")`).all() as any[];
  const names: string[] = [], vals: any[] = [];
  for (const c of cols) {
    const n = c.name as string; let v: any;
    if (n in overrides) v = overrides[n];
    else if (c.pk === 1 && !(n in overrides)) continue; // autoincrement
    else if (!c.notnull || c.dflt_value !== null) continue; // optional/defaulted
    else {
      const chk = checkFirstAllowed(meta.sql, n);
      if (chk !== null) v = chk;
      else if (/INT/i.test(c.type)) v = 1;
      else if (/REAL|FLOA|DOUB|NUM/i.test(c.type)) v = 1;
      else if (/date/i.test(n) || /_at$/.test(n) || /_on$/.test(n)) v = now;
      else v = "seed";
    }
    names.push(`"${n}"`); vals.push(v);
  }
  sqlite.prepare(`INSERT OR REPLACE INTO "${table}" (${names.join(",")}) VALUES (${names.map(() => "?").join(",")})`).run(...vals);
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const admReq = (p: string, b: any) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const prov = await (await admReq("/api/admin/provision-owner-lab", {
    secret: "localadmin", ownerEmail: "owner@qa.test", ownerName: "QA Owner",
    labName: "QA Gate Lab", cliaNumber: "22D9999001", plan: "enterprise", accreditationBody: "TJC",
  })).json();
  const LAB = prov.lab_id, ownerId = prov.owner_user_id;
  if (!LAB || !ownerId) throw new Error("provision failed: " + JSON.stringify(prov));

  const mkUser = (email: string, name: string) => { const u = storage.createUser(email, "$2a$10$abcdefghijklmnopqrstuv", name) as any; sqlite.prepare("UPDATE users SET plan='enterprise', hipaa_acknowledged=1 WHERE id=?").run(u.id); return u.id as number; };
  const adminId = mkUser("admin@qa.test", "QA Admin");
  const mdId = mkUser("md@qa.test", "Dr Director");
  const tsId = mkUser("ts@qa.test", "Terry Supervisor");
  const tcId = mkUser("tc@qa.test", "Casey Consultant");
  const plainId = mkUser("plain@qa.test", "Pat Member");
  const addMember = (uid: number, role: string) => sqlite.prepare("INSERT OR IGNORE INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'{}','active',0,?,?,?)").run(LAB, uid, role, now, now, now);
  addMember(adminId, "admin"); addMember(mdId, "staff"); addMember(tsId, "staff"); addMember(tcId, "staff"); addMember(plainId, "staff");
  sqlite.prepare("UPDATE labs SET medical_director_email=? WHERE id=?").run("md@qa.test", LAB);

  // VeritaMap complexity: Glucose HIGH, Sodium MODERATE -> lab highest complexity = HIGH.
  sqlite.pragma("foreign_keys = OFF");
  seedRow("veritamap_maps", { id: 5001, lab_id: LAB });
  seedRow("veritamap_tests", { map_id: 5001, analyte: "Glucose", complexity: "HIGH" });
  seedRow("veritamap_tests", { map_id: 5001, analyte: "Sodium", complexity: "MODERATE" });
  seedRow("qc_control_lots", { id: 776, lab_id: LAB, analyte: "Glucose" });
  seedRow("qc_control_lots", { id: 777, lab_id: LAB, analyte: "Sodium" });
  seedRow("findings", { id: 888, lab_id: LAB, user_id: ownerId });
  sqlite.pragma("foreign_keys = ON");

  const tok = (uid: number) => jwt.sign({ userId: uid }, SECRET, { expiresIn: "1h" });
  const T: Record<string, string> = { owner: tok(ownerId), admin: tok(adminId), md: tok(mdId), ts: tok(tsId), tc: tok(tcId), plain: tok(plainId) };
  const call = (method: string, path: string, who: string, body?: any) =>
    fetch(base + path, { method, headers: { "Content-Type": "application/json", "X-Active-Lab-Id": String(LAB), Authorization: `Bearer ${T[who]}` }, body: body === undefined ? undefined : JSON.stringify(body) });

  // MD creates + signs two delegations: TS (qc_period_cosign + finding_closure, high) and TC (qc_period_cosign, moderate).
  const makeDelegation = async (delegateUser: number, name: string, position: string, complexity: string, resp: any) => {
    const c = await (await call("POST", `/api/labs/${LAB}/director-delegations`, "md", { delegate_name: name, delegate_user_id: delegateUser, position, complexity_scope: complexity, responsibilities: resp })).json();
    const s = await call("POST", `/api/labs/${LAB}/director-delegations/${c.id}/sign`, "md", { signed_name: "Dr Director, MD" });
    return s.status === 200;
  };
  check("seed: TS delegation signed", await makeDelegation(tsId, "Terry Supervisor", "technical_supervisor", "high", { qc_period_cosign: true, finding_closure: true }));
  check("seed: TC delegation signed", await makeDelegation(tcId, "Casey Consultant", "technical_consultant", "moderate", { qc_period_cosign: true }));

  const cosign = (who: string, lotId: number) => call("POST", `/api/labs/${LAB}/qc/period-reviews/md-cosign`, who, { control_lot_id: lotId, period_year: 2026, period_month: 10 });
  const not403 = (s: number) => s !== 403; // gate passed (409 "no attestation filed" is fine for this test)

  // QC co-sign on a HIGH-complexity lot (Glucose, lot 776).
  check("HIGH co-sign: MD passes gate", not403((await cosign("md", 776)).status));
  check("HIGH co-sign: TS designee passes gate", not403((await cosign("ts", 776)).status));
  check("HIGH co-sign: TC designee BLOCKED (cannot cover high)", (await cosign("tc", 776)).status === 403);
  check("HIGH co-sign: plain member BLOCKED", (await cosign("plain", 776)).status === 403);
  check("HIGH co-sign: owner override passes gate", not403((await cosign("owner", 776)).status));

  // QC co-sign on a MODERATE-complexity lot (Sodium, lot 777) - TC now covers it.
  check("MOD co-sign: TC designee passes gate", not403((await cosign("tc", 777)).status));

  // Finding closure (lab highest complexity = HIGH). Test blocked first, then allowed.
  const signoff = (who: string) => call("POST", `/api/labs/${LAB}/findings/888/signoff`, who, {});
  check("finding close: TC designee BLOCKED (no finding_closure + high)", (await signoff("tc")).status === 403);
  check("finding close: plain member BLOCKED", (await signoff("plain")).status === 403);
  check("finding close: non-MD admin BLOCKED (tightened from old owner/admin allowance)", (await signoff("admin")).status === 403);
  check("finding close: MD allowed (200)", (await signoff("md")).status === 200);
  check("finding close: TS designee allowed (200)", (await signoff("ts")).status === 200);
  check("finding close: owner override allowed (200)", (await signoff("owner")).status === 200);

  server.close();
  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
