// scripts/verify-access-pr-a.ts
//
// Gate 3 receipt for PR A (access-control fixes). Boots the REAL routes on a fresh throwaway
// SQLite DB (no prod data), seeds the four real account types, and asserts the post-fix
// access matrix for each change:
//   1. Global export/report POSTs  -> a Staff Portal seat is 403; owner/admin/active-seat reach.
//   2. Jurisdiction                -> Staff Portal seat AND a plain (role 'staff') member are 403;
//                                      owner + admin reach.
//   3. Medical-director designation -> admin is 403 (owner-only); owner reaches.
//      3b. The same through the invite form (POST /members role medical_director).
//   4. Legacy /api/account/seats    -> non-owners (admin/staff/md) are 403; owner reaches.
//
// Run (from repo root):
//   DB_PATH=.tmp-verify-pra.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin \
//   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy \
//   node_modules/.bin/tsx scripts/verify-access-pr-a.ts

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
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (${detail})`);
  if (!ok) fails++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const adm = (p: string, b: any) =>
    fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });

  // ── Seed owner + lab, then admin / staff-portal / medical-director ──
  const prov = await (await adm("/api/admin/provision-owner-lab", {
    secret: "localadmin", ownerEmail: "owner@qa.test", ownerName: "QA Owner",
    labName: "QA PRA Lab", cliaNumber: "22D9999001", plan: "enterprise", accreditationBody: "TJC",
  })).json();
  const LAB_ID = prov.lab_id, ownerId = prov.owner_user_id;
  if (!LAB_ID || !ownerId) throw new Error("provision failed: " + JSON.stringify(prov));

  const mkUser = (email: string, name: string) => {
    const u = storage.createUser(email, "$2a$10$abcdefghijklmnopqrstuv", name) as any;
    sqlite.prepare("UPDATE users SET plan='enterprise', hipaa_acknowledged=1 WHERE id=?").run(u.id);
    return u.id as number;
  };
  const adminId = mkUser("admin@qa.test", "QA Admin");
  const staffId = mkUser("staff@qa.test", "QA Staff");
  const mdId = mkUser("md@qa.test", "QA MedDir");

  const addMember = (uid: number, role: string) =>
    sqlite.prepare(
      "INSERT OR IGNORE INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'{}','active',0,?,?,?)"
    ).run(LAB_ID, uid, role, now, now, now);
  addMember(adminId, "admin");
  addMember(mdId, "staff"); // MD's base membership role is staff-level
  sqlite.prepare("UPDATE labs SET medical_director_email=? WHERE id=?").run("md@qa.test", LAB_ID);
  // staff-portal (read-and-sign) seat for staff; active (writer) seat for the MD
  sqlite.prepare(
    "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, lab_id, seat_type) VALUES (?,?,?,?,?,'active',?,?,'staff_portal')"
  ).run(ownerId, "staff@qa.test", staffId, now, now, JSON.stringify({ mode: "view_all" }), LAB_ID);
  sqlite.prepare(
    "INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, lab_id, seat_type) VALUES (?,?,?,?,?,'active',?,?,'active')"
  ).run(ownerId, "md@qa.test", mdId, now, now, JSON.stringify({ mode: "edit_all" }), LAB_ID);

  const tok = (uid: number) => jwt.sign({ userId: uid }, SECRET, { expiresIn: "1h" });
  const T = { owner: tok(ownerId), admin: tok(adminId), staff: tok(staffId), md: tok(mdId) };

  const hit = async (method: string, path: string, who: keyof typeof T) => {
    const r = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", "X-Active-Lab-Id": String(LAB_ID), Authorization: `Bearer ${T[who]}` },
      body: method === "GET" ? undefined : JSON.stringify({}),
    });
    return r.status;
  };

  // 1. Export/report POST sweep: staff portal seat must be 403; owner + admin must NOT be 403.
  const exportRoutes = [
    "/api/veritalab/certificates/excel",
    "/api/veritapt/pdf",
    "/api/productivity/leverage-report",
    "/api/inventory/reorder-list/pdf",
    "/api/inventory/count-history/xlsx",
    "/api/inventory/snap-order/pdf",
    "/api/inventory/labels/pdf",
    "/api/inventory/count-sheet/excel",
    "/api/inventory/reorder-list/excel",
    `/api/veritaops/studies/1/pdf`,
    "/api/veritacheck/verifications/1/pdf",
    "/api/veritacheck/cumsum/trackers/1/pdf",
    "/api/veritamap/maps/1/excel",
    "/api/pi/metrics/1/report",
  ];
  for (const p of exportRoutes) {
    const s = await hit("POST", p, "staff");
    const o = await hit("POST", p, "owner");
    check(`export staff-blocked  POST ${p}`, s === 403, `staff=${s}`);
    check(`export owner-reaches  POST ${p}`, o !== 403 && o !== 401, `owner=${o}`);
  }

  // 2. Jurisdiction: staff + md (plain member) blocked; owner + admin reach.
  {
    const js = await hit("POST", `/api/labs/${LAB_ID}/jurisdiction`, "staff");
    const jm = await hit("POST", `/api/labs/${LAB_ID}/jurisdiction`, "md");
    const jo = await hit("POST", `/api/labs/${LAB_ID}/jurisdiction`, "owner");
    const ja = await hit("POST", `/api/labs/${LAB_ID}/jurisdiction`, "admin");
    check("jurisdiction staff-blocked", js === 403, `staff=${js}`);
    check("jurisdiction md-blocked", jm === 403, `md=${jm}`);
    check("jurisdiction owner-reaches", jo !== 403 && jo !== 401, `owner=${jo}`);
    check("jurisdiction admin-reaches", ja !== 403 && ja !== 401, `admin=${ja}`);
  }

  // 3. Medical-director designation: owner-only. admin + staff blocked; owner reaches.
  {
    const da = await hit("PUT", `/api/labs/${LAB_ID}/medical-director`, "admin");
    const ds = await hit("PUT", `/api/labs/${LAB_ID}/medical-director`, "staff");
    const dobj = await hit("PUT", `/api/labs/${LAB_ID}/medical-director`, "owner");
    check("md-designation admin-blocked", da === 403, `admin=${da}`);
    check("md-designation staff-blocked", ds === 403, `staff=${ds}`);
    check("md-designation owner-reaches", dobj !== 403 && dobj !== 401, `owner=${dobj}`);
  }

  // 3b. Bug 3 (2026-10-09): the INVITE path must not let an admin designate the
  // medical director either (POST /members with role medical_director).
  {
    const invite = async (who: string, email: string) => {
      const r = await fetch(base + `/api/labs/${LAB_ID}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Active-Lab-Id": String(LAB_ID), Authorization: `Bearer ${T[who]}` },
        body: JSON.stringify({ email, role: "medical_director", seatType: "active" }),
      });
      return r.status;
    };
    const ia = await invite("admin", "md-by-admin@qa.test");
    const mdAfterAdmin = (sqlite.prepare("SELECT medical_director_email AS e FROM labs WHERE id=?").get(LAB_ID) as any)?.e;
    check("md-invite admin-blocked", ia === 403, `admin=${ia}`);
    check("md-invite admin did not change the director", mdAfterAdmin !== "md-by-admin@qa.test", `director=${mdAfterAdmin}`);
    const io = await invite("owner", "md-by-owner@qa.test");
    check("md-invite owner-reaches", io !== 403 && io !== 401, `owner=${io}`);
  }

  // 4. Legacy /api/account/seats: non-owners blocked; owner reaches.
  {
    const sa = await hit("POST", "/api/account/seats", "admin");
    const ss = await hit("POST", "/api/account/seats", "staff");
    const sm = await hit("POST", "/api/account/seats", "md");
    const so = await hit("POST", "/api/account/seats", "owner");
    check("account-seats admin-blocked", sa === 403, `admin=${sa}`);
    check("account-seats staff-blocked", ss === 403, `staff=${ss}`);
    check("account-seats md-blocked", sm === 403, `md=${sm}`);
    check("account-seats owner-reaches", so !== 403 && so !== 401, `owner=${so}`);
  }

  server.close();
  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
