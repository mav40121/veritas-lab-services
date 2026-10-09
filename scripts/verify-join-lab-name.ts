// scripts/verify-join-lab-name.ts
//
// Receipt for BUG-008 (2026-10-09, found while verifying BUG-002): the join page
// named the lab after the OWNER ("join Lab Owner") because GET /api/seats/invite/:token
// read the owner's account fields, not the invite's lab. Boots the REAL routes on a
// throwaway SQLite DB and checks:
//   1. An invite to a lab returns that lab's name.
//   2. A multi-lab owner's invites each return their own lab's name.
//   3. A legacy invite with no lab still falls back to the owner's account name.
// Run (from repo root):
//   DB_PATH=.tmp-verify-join.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin \
//   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy \
//   node_modules/.bin/tsx scripts/verify-join-lab-name.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../server/routes";
import { db } from "../server/db";
import { storage } from "../server/storage";
(globalThis as any).require ??= createRequire(import.meta.url);

const sqlite = (db as any).$client;
const now = new Date().toISOString();
let fails = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (${detail})`);
  if (!ok) fails++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const owner = storage.createUser("owner@qa.test", "$2a$10$abcdefghijklmnopqrstuv", "Lab Owner") as any;
  sqlite.prepare("UPDATE users SET clia_lab_name = NULL, hospital_name = NULL WHERE id = ?").run(owner.id);
  const mkLab = (name: string) => Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, created_at, updated_at) VALUES (?,?,?,?,?)").run(name, owner.id, "hospital", now, now).lastInsertRowid);
  const labA = mkLab("Invite Names Lab"), labB = mkLab("Second Site Lab");
  const invite = (labId: number | null, email: string, token: string) =>
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, invited_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?,?,?,'pending','{}',?,?,'active')").run(owner.id, email, now, token, labId);
  invite(labA, "a@qa.test", "tok-a");
  invite(labB, "b@qa.test", "tok-b");
  invite(null, "legacy@qa.test", "tok-legacy");
  const look = async (t: string) => (await fetch(`${base}/api/seats/invite/${t}`)).json() as any;

  const a = await look("tok-a");
  check("invite returns the invited lab's name, not the owner's", a.labName === "Invite Names Lab", `labName=${a.labName}`);
  const b = await look("tok-b");
  check("a multi-lab owner's second lab returns its own name", b.labName === "Second Site Lab", `labName=${b.labName}`);
  const l = await look("tok-legacy");
  check("a legacy invite with no lab still falls back to the account", l.labName === "Lab Owner", `labName=${l.labName}`);

  server.close();
  console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILURE(S)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
