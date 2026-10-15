// scripts/verify-fda-deviation.mjs
//
// St. Charles demo ask (2026-10-14, REQ-065): record FDA product deviations in VeritaResponse under
// 21 CFR 606.171. Boots the built server on a COPY of a production backup (never written) and checks,
// on Michaels Lab (lab 3; LAB= to change):
//   1. an FDA deviation with all three 606.171(b) answers "yes" gets a report-by date 45 calendar days
//      after the information date, as its due date; filed under 'Other' with standard 21 CFR 606.171
//   2. one with "product distributed: no" is not reportable: no report-by date, no due date
//   3. a submission date before the information date is refused (400)
//   4. recording the Form FDA 3486 submission stores the date and the confirmation number
//   5. changing an answer to "no" clears the report-by date
//   6. the FDA route refuses a finding that is not an FDA deviation (400)
//   7. the general finding update keeps an FDA deviation's report-by date (no accreditor recompute)
//   8. an unknown source type is still refused (400)
//   9. BUG-054: Save through the lab-scoped finding URL (what the finding page uses) works
//  10. ...and cannot save another lab's finding (404)
// Usage: node scripts/verify-fda-deviation.mjs <backup.db>   (after npm run build)
//   DIST=<other dist/index.cjs> runs the same checks against another build (harness-bites run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5178, SECRET = "fdadev-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-fda-deviation.mjs <backup.db> (after npm run build)"); process.exit(2); }

const LAB = Number(process.env.LAB || 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fdadev-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const ro = new Database(dbPath, { readonly: true });
const owner = ro.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(LAB).owner_user_id;
ro.close();
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const done = async () => { child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true }); };

const H = { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ svc: true, userId: owner }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(LAB) };
const B = `http://localhost:${PORT}/api/labs/${LAB}/findings`;
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const send = (url, body, method = "POST") => fetch(url, { method, headers: H, body: JSON.stringify(body) });

const base = { source_type: "fda_deviation", status: "open", description: "QA: unit released past its temperature limit", fda_info_date: "2026-10-01", fda_product_type: "red_cells", fda_product_id: "QA-UNIT-1", fda_event_kind: "deviation" };
const r1 = await send(B, { ...base, fda_affects_product: "yes", fda_in_facility: "yes", fda_distributed: "yes" });
const f1 = await j(r1);
check("1. all three yes: report-by = info date + 45 days, as the due date, filed under Other / 21 CFR 606.171",
  r1.status === 201 && f1.fda_report_due === "2026-11-15" && f1.due_date === "2026-11-15" && f1.accreditor === "Other" && f1.standard_ref === "21 CFR 606.171" && f1.fda_distributed === 1,
  `${r1.status} ${JSON.stringify({ due: f1.fda_report_due, due_date: f1.due_date, acc: f1.accreditor, ref: f1.standard_ref })}`);
const r2 = await send(B, { ...base, fda_affects_product: "yes", fda_in_facility: "yes", fda_distributed: "no" });
const f2 = await j(r2);
check("2. product not distributed: not reportable, no report-by date and no due date", r2.status === 201 && f2.fda_report_due == null && f2.due_date == null, `${r2.status} ${JSON.stringify({ due: f2.fda_report_due, due_date: f2.due_date })}`);
const r3 = await send(`${B}/${f1.id}/fda`, { fda_submitted_date: "2026-09-01" }, "PATCH");
check("3. a submission date before the information date is refused", r3.status === 400, String(r3.status));
const r4 = await send(`${B}/${f1.id}/fda`, { fda_submitted_date: "2026-10-20", fda_confirmation_number: "BPDR-QA-123" }, "PATCH");
const f4 = await j(r4);
check("4. the Form FDA 3486 submission date and confirmation number are stored", r4.status === 200 && f4.fda_submitted_date === "2026-10-20" && f4.fda_confirmation_number === "BPDR-QA-123" && f4.fda_report_due === "2026-11-15", `${r4.status} ${JSON.stringify({ s: f4.fda_submitted_date, c: f4.fda_confirmation_number, due: f4.fda_report_due })}`);
const r5 = await send(`${B}/${f2.id}/fda`, { fda_distributed: "yes" }, "PATCH");
const f5 = await j(r5);
const r5b = await send(`${B}/${f2.id}/fda`, { fda_distributed: "no" }, "PATCH");
const f5b = await j(r5b);
check("5. answers drive the date: yes sets it, changing to no clears it", f5.fda_report_due === "2026-11-15" && f5b.fda_report_due == null && f5b.due_date == null, JSON.stringify({ set: f5.fda_report_due, cleared: f5b.fda_report_due }));
const rn = await send(B, { source_type: "internal_nce", status: "open", description: "QA NCE", event_date: "2026-10-01" });
const fn = await j(rn);
const r6 = await send(`${B}/${fn.id}/fda`, { fda_distributed: "yes" }, "PATCH");
check("6. the FDA route refuses a finding that is not an FDA deviation", r6.status === 400, String(r6.status));
const r7 = await fetch(`http://localhost:${PORT}/api/findings/${f1.id}`, { method: "PUT", headers: H, body: JSON.stringify({ anchor_date: "2026-10-05", description: "QA edit" }) });
const f7 = (await j(await fetch(`${B}/${f1.id}`, { headers: H })));
const f7row = f7.finding || f7;
check("7. the general update keeps the FDA report-by date as the due date", r7.status === 200 && f7row.due_date === "2026-11-15", `${r7.status} due_date=${f7row.due_date}`);
const r8 = await send(B, { source_type: "made_up", accreditor: "CMS" });
check("8. an unknown source type is still refused", r8.status === 400, String(r8.status));

// BUG-054: the finding page saves to the lab-scoped URL; that PUT route did not exist (404 on every Save).
const r9 = await fetch(`${B}/${fn.id}`, { method: "PUT", headers: H, body: JSON.stringify({ description: "QA saved through the lab-scoped route", root_cause: "QA root cause" }) });
const f9 = await j(r9);
check("9. BUG-054: Save through the lab-scoped finding URL works", r9.status === 200 && f9.description === "QA saved through the lab-scoped route" && f9.root_cause === "QA root cause", `${r9.status} ${JSON.stringify({ d: f9.description })}`);
const ro2 = new Database(dbPath, { readonly: true });
const other = ro2.prepare("SELECT id FROM findings WHERE lab_id IS NOT NULL AND lab_id <> ? ORDER BY id LIMIT 1").get(LAB);
ro2.close();
if (other) {
  const r10 = await fetch(`${B}/${other.id}`, { method: "PUT", headers: H, body: JSON.stringify({ description: "cross-lab" }) });
  check("10. BUG-054: a finding from another lab cannot be saved through this lab's URL", r10.status === 404, String(r10.status));
} else console.log("SKIP  10. no finding in another lab on this copy");

await done();
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
