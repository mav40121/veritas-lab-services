// scripts/verify-veritapolicy-author-may-approve.mjs
//
// "Allow the author to approve this step" (Michael 2026-10-14, Q187 = 2). By default the person who uploaded a
// policy cannot approve any of its review steps. A lab owner or admin can now turn that on per workflow step
// (PATCH /api/labs/:labId/veritapolicy/workflows/:id/steps/:stepId {allowSelfApproval}). Boots the built server on a
// COPY of a production backup (never written) and checks, using the first in-review document whose author is the
// lab owner (Redington's "Critical Lab or Diagnostic Test Results Reporting", Lindsay Webber, on the 10/14 backup):
//   1. before: the document is NOT in its author's "Pending my review"
//   2. turning the switch on for the document's current step returns 200, and the step reads back allow_self_approval 1
//   3. after: the document IS in the author's "Pending my review" (takes effect for documents already waiting)
//   4. the workflow's other steps are unchanged (still 0)
//   5. a lab member who is not owner or admin gets 403 from the switch
//   6. turning it off again removes the document from the author's queue
// Usage: node scripts/verify-veritapolicy-author-may-approve.mjs <production-backup.db> [documentId, default 61]   (after npm run build)
// The document must be in review at step 1 of its own workflow (61 = Redington's, on the 10/14 backup).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = path.join(ROOT, "dist", "index.cjs"), PORT = 5173, SECRET = "authorapprove-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-veritapolicy-author-may-approve.mjs <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "authorapprove-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }

const ro = new Database(dbPath, { readonly: true });
const DOC = Number(process.argv[3] || 61);
const doc = ro.prepare(`SELECT d.id, d.lab_id, d.title, d.owner_user_id, d.workflow_id FROM policy_documents d WHERE d.id = ? AND d.status = 'in_review'`).get(DOC);
const other = doc && ro.prepare(`SELECT user_id FROM lab_members WHERE lab_id = ? AND status = 'active' AND role NOT IN ('owner','admin') LIMIT 1`).get(doc.lab_id);
ro.close();
if (!doc) { console.error(`document ${DOC} is not in review in this backup`); child.kill(); process.exit(2); }
console.log(`document ${doc.id} "${doc.title}" (lab ${doc.lab_id}, author user ${doc.owner_user_id})`);
const H = (u) => ({ "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ svc: true, userId: u }, SECRET, { expiresIn: "5m" })}`, "X-Active-Lab-Id": String(doc.lab_id) });
const B = `http://localhost:${PORT}/api/labs/${doc.lab_id}/veritapolicy`;
const pending = async (u) => ((await (await fetch(`${B}/pending-reviews`, { headers: H(u) })).json()).pending || []);
const workflows = async () => ((await (await fetch(`${B}/workflows`, { headers: H(doc.owner_user_id) })).json()).workflows || []);

const before = await pending(doc.owner_user_id);
check("1. before: the document is not in its author's Pending my review", !before.some((p) => p.document_id === doc.id), JSON.stringify(before.map((p) => p.document_id)));
// The document's current step: read from the owner's own pending list after the switch, so find it via the workflows + a reviewer's view.
const wfs = await workflows();
const stepOwner = wfs.find((w) => w.id === doc.workflow_id);
const firstStep = stepOwner?.steps.find((s) => s.step_order === 1);
const r1 = await fetch(`${B}/workflows/${stepOwner?.id}/steps/${firstStep?.id}`, { method: "PATCH", headers: H(doc.owner_user_id), body: JSON.stringify({ allowSelfApproval: true }) });
const after1 = (await workflows()).find((w) => w.id === stepOwner?.id);
check(`2. switch on for "${stepOwner?.name}: ${firstStep?.step_name}" returns 200 and reads back 1`, r1.status === 200 && after1?.steps.find((s) => s.id === firstStep?.id)?.allow_self_approval === 1, `${r1.status}`);
const after = await pending(doc.owner_user_id);
check("3. after: the document is in its author's Pending my review", after.some((p) => p.document_id === doc.id), JSON.stringify(after.map((p) => p.document_id)));
check("4. the workflow's other steps are unchanged", (after1?.steps || []).filter((s) => s.id !== firstStep?.id).every((s) => s.allow_self_approval === 0), JSON.stringify(after1?.steps));
if (other) {
  const r403 = await fetch(`${B}/workflows/${stepOwner?.id}/steps/${firstStep?.id}`, { method: "PATCH", headers: H(other.user_id), body: JSON.stringify({ allowSelfApproval: false }) });
  check("5. a member who is not owner or admin gets 403", r403.status === 403, String(r403.status));
} else console.log("SKIP  5. no non-owner, non-admin member in this lab");
const r2 = await fetch(`${B}/workflows/${stepOwner?.id}/steps/${firstStep?.id}`, { method: "PATCH", headers: H(doc.owner_user_id), body: JSON.stringify({ allowSelfApproval: false }) });
const off = await pending(doc.owner_user_id);
check("6. switch off again: the document leaves the author's queue", r2.status === 200 && !off.some((p) => p.document_id === doc.id), `${r2.status} ${JSON.stringify(off.map((p) => p.document_id))}`);
child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS"); process.exit(fails ? 1 : 0);
