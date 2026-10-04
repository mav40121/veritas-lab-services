// scripts/verify-md-delegation.ts
//
// Gate 3 receipt for item-5 Phase 1 (Medical Director Letter of Delegation).
// Boots the real routes on a fresh throwaway DB, seeds owner / admin / designated MD,
// and asserts the MD-only lifecycle plus the PDF. No production data.
//
// Run:
//   DB_PATH=.tmp-verify-dd.db JWT_SECRET=localqasecret ADMIN_SECRET=localadmin \
//   STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy RESEND_API_KEY=re_dummy \
//   node_modules/.bin/tsx scripts/verify-md-delegation.ts

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import fs from "node:fs";
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

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const adm = (p: string, b: any) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const prov = await (await adm("/api/admin/provision-owner-lab", {
    secret: "localadmin", ownerEmail: "owner@qa.test", ownerName: "QA Owner",
    labName: "QA Delegation Lab", cliaNumber: "22D9999001", plan: "enterprise", accreditationBody: "TJC",
  })).json();
  const LAB = prov.lab_id, ownerId = prov.owner_user_id;
  if (!LAB || !ownerId) throw new Error("provision failed: " + JSON.stringify(prov));

  const mkUser = (email: string, name: string) => { const u = storage.createUser(email, "$2a$10$abcdefghijklmnopqrstuv", name) as any; sqlite.prepare("UPDATE users SET plan='enterprise', hipaa_acknowledged=1 WHERE id=?").run(u.id); return u.id as number; };
  const adminId = mkUser("admin@qa.test", "QA Admin");
  const mdId = mkUser("md@qa.test", "Dr QA Director");
  const addMember = (uid: number, role: string) => sqlite.prepare("INSERT OR IGNORE INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?,?,?,'{}','active',0,?,?,?)").run(LAB, uid, role, now, now, now);
  addMember(adminId, "admin");
  addMember(mdId, "staff");
  sqlite.prepare("UPDATE labs SET medical_director_email=? WHERE id=?").run("md@qa.test", LAB);

  const tok = (uid: number) => jwt.sign({ userId: uid }, SECRET, { expiresIn: "1h" });
  const T = { owner: tok(ownerId), admin: tok(adminId), md: tok(mdId) };
  const call = async (method: string, path: string, who: keyof typeof T, body?: any) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", "X-Active-Lab-Id": String(LAB), Authorization: `Bearer ${T[who]}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    return r;
  };

  // Non-MD cannot create (owner is NOT the MD here).
  check("owner (non-MD) create -> 403", (await call("POST", `/api/labs/${LAB}/director-delegations`, "owner", { delegate_name: "x", position: "technical_supervisor" })).status === 403);
  check("admin (non-MD) create -> 403", (await call("POST", `/api/labs/${LAB}/director-delegations`, "admin", { delegate_name: "x", position: "technical_supervisor" })).status === 403);

  // MD creates a draft (TS, high) with the two gated toggles on + one INVALID toggle for the position.
  const createRes = await call("POST", `/api/labs/${LAB}/director-delegations`, "md", {
    delegate_name: "Jane Tech, MLS(ASCP)", delegate_user_id: adminId, position: "technical_supervisor", complexity_scope: "high",
    responsibilities: { qc_period_cosign: true, finding_closure: true, personnel_competency: true, cc_consult: true /* invalid for TS - should be dropped */ },
  });
  check("MD create draft -> 201", createRes.status === 201);
  const id = (await createRes.json()).id;

  // List shows it with sanitized responsibilities (cc_consult dropped; gated two present).
  const listed = await (await call("GET", `/api/labs/${LAB}/director-delegations`, "md")).json();
  const row = listed.find((r: any) => r.id === id);
  check("draft appears in list", !!row && row.status === "draft");
  check("invalid toggle (cc_consult) dropped for TS", !!row && row.responsibilities.cc_consult === undefined, JSON.stringify(row?.responsibilities));
  check("gated toggles persisted", !!row && row.responsibilities.qc_period_cosign === true && row.responsibilities.finding_closure === true);

  // Edit draft (MD only) - turn finding_closure off.
  check("MD edit draft -> 200", (await call("PUT", `/api/labs/${LAB}/director-delegations/${id}`, "md", { responsibilities: { qc_period_cosign: true, finding_closure: false, personnel_competency: true } })).status === 200);
  check("non-MD edit -> 403", (await call("PUT", `/api/labs/${LAB}/director-delegations/${id}`, "admin", { delegate_name: "hax" })).status === 403);

  // Sign (MD only).
  check("non-MD sign -> 403", (await call("POST", `/api/labs/${LAB}/director-delegations/${id}/sign`, "owner", {})).status === 403);
  const signRes = await call("POST", `/api/labs/${LAB}/director-delegations/${id}/sign`, "md", { signed_name: "Dr QA Director, MD" });
  check("MD sign -> 200", signRes.status === 200);
  const signed = await (await call("GET", `/api/labs/${LAB}/director-delegations`, "md")).json();
  const srow = signed.find((r: any) => r.id === id);
  check("letter is active + signed", !!srow && srow.status === "active" && !!srow.signed_at && srow.signed_name === "Dr QA Director, MD");

  // Edit after sign blocked.
  check("edit signed letter -> 409", (await call("PUT", `/api/labs/${LAB}/director-delegations/${id}`, "md", { delegate_name: "nope" })).status === 409);

  // PDF generates.
  const pdfRes = await call("GET", `/api/labs/${LAB}/director-delegations/${id}/pdf`, "md");
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check("PDF -> 200 application/pdf", pdfRes.status === 200 && (pdfRes.headers.get("content-type") || "").includes("pdf"));
  check("PDF buffer looks like a PDF", pdfBuf.length > 2000 && pdfBuf.slice(0, 5).toString() === "%PDF-", `${pdfBuf.length} bytes`);
  const outPdf = process.env.SAMPLE_PDF_OUT;
  if (outPdf) { fs.writeFileSync(outPdf, pdfBuf); console.log("wrote sample PDF:", outPdf); }

  // Catalog endpoint.
  const cat = await (await call("GET", `/api/labs/${LAB}/director-delegations/catalog`, "md")).json();
  check("catalog returns items", Array.isArray(cat.catalog) && cat.catalog.length >= 8 && Array.isArray(cat.positions));

  // Revoke (MD only), then revoke again blocked.
  check("MD revoke -> 200", (await call("POST", `/api/labs/${LAB}/director-delegations/${id}/revoke`, "md", {})).status === 200);
  check("revoke again -> 409", (await call("POST", `/api/labs/${LAB}/director-delegations/${id}/revoke`, "md", {})).status === 409);

  server.close();
  console.log(`\n${fails === 0 ? "ALL PASS" : fails + " FAILED"}`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("FATAL", e); process.exit(1); });
