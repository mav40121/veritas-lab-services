// scripts/verify-method-signoff-determination.mjs
//
// BUG-051 (2026-10-14, Michael): the per-method sign-off dropped the Overall Determination (Pass / Fail /
// Remediation Required) the whole-record form had, so every sign-off read as competent. Boots the built server on a
// COPY of a production backup (never written) and, on Michaels Lab (lab 3, where it was reported; LAB= to change),
// walks one ready-to-sign method through the remediation cycle: signed Remediation Required, reassessment entered
// again, signed Pass. Checks:
//   1. an unknown determination is refused (400)
//   2. Remediation Required without an action plan is refused (400)
//   3. Remediation Required with an action plan and target date is accepted (200)
//   4. the person view reads it back: determination, plan and target date on the sign-off
//   5. ...and does not count it: needsRemediation true, signedCurrent false, the SAME competency is next
//   6. Competencies owed still counts the method as not assessed
//   7. the record PDF shows "Remediation required" and the action plan, below the sign-off block (signature stays first)
//   8. after the reassessment is entered and signed Pass: current again, the next competency advances, and the
//      earlier Remediation Required sign-off stays in the history
//   9. Competencies owed now counts the method assessed
// Usage: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/verify-method-signoff-determination.mjs <backup.db>
//   (after npm run build; tsx lets check 7 import server/pdfReport.ts). DIST=<other dist/index.cjs> runs the same checks
//   against another build (harness-bites run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5176, SECRET = "determination-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: ... <backup.db> (after npm run build)"); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "determination-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const done = async () => { child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true }); };

const LAB = Number(process.env.LAB || 3);
const ro = new Database(dbPath, { readonly: true });
const owner = ro.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(LAB).owner_user_id;
const staff = ro.prepare("SELECT id FROM staff_employees WHERE tier2_lab_id = ? AND status = 'active' ORDER BY id").all(LAB).map((r) => r.id);
ro.close();
const H = { "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ userId: owner }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(LAB) };
const B = `http://localhost:${PORT}/api/labs/${LAB}/competency`;
const view = async (id) => (await fetch(`${B}/employee/${id}`, { headers: H })).json();
const methodOf = async (id, instrumentId) => (await view(id)).testSystems.find((t) => t.instrumentId === instrumentId);
const owedOf = async (empId, instrumentId) => {
  const o = await (await fetch(`${B}/owed`, { headers: H })).json();
  return (o.employees || []).find((e) => e.employeeId === empId)?.owed?.find((x) => x.instrumentId === instrumentId);
};

let pick = null;
for (const id of staff) {
  const v = await view(id);
  for (const t of v.testSystems || []) {
    const s = (t.signers || []).find((o) => o.eligible);
    if (!pick && t.signable && s && !t.fromLegacyProgram) pick = { empId: id, name: v.employee?.name, t, s };
  }
  if (pick) break;
}
if (!pick) { console.error(`no ready-to-sign method on lab ${LAB}`); await done(); process.exit(2); }
const { empId, t, s } = pick;
console.log(`${pick.name} / ${t.instrumentName}: ${t.nextMilestone}, signer ${s.name}`);
const sign = (extra) => fetch(`${B}/employee/${empId}/test-system/${t.instrumentId}/sign`, {
  method: "POST", headers: H,
  body: JSON.stringify({ signerStaffEmployeeId: s.staffEmployeeId, signerIsMedicalDirector: s.staffEmployeeId == null, signerInitials: "QA", milestone: t.nextMilestone, ...extra }),
});

const r1 = await sign({ determination: "maybe" });
check("1. an unknown determination is refused", r1.status === 400, String(r1.status));
const r2 = await sign({ determination: "remediation" });
check("2. Remediation Required without an action plan is refused", r2.status === 400, `${r2.status} ${JSON.stringify(await r2.json().catch(() => ({})))}`);
const r3 = await sign({ determination: "remediation", remediationPlan: "Retrain on gel card reading; observe 5 runs; reassess.", remediationTargetDate: "2026-11-15" });
check("3. Remediation Required with a plan and target date is accepted", r3.status === 200, `${r3.status} ${JSON.stringify(await r3.json().catch(() => ({})))}`);

const a = await methodOf(empId, t.instrumentId);
const last = a?.lastSignoff || {};
check("4. the person view reads back the determination, plan and target date",
  last.determination === "remediation" && /Retrain on gel card reading/.test(last.remediationPlan || "") && last.remediationTargetDate === "2026-11-15", JSON.stringify(last));
check("5. ...and does not count it: needsRemediation, not current, the same competency is next",
  a?.needsRemediation === true && a?.signedCurrent === false && a?.nextMilestone === t.nextMilestone,
  JSON.stringify({ needsRemediation: a?.needsRemediation, signedCurrent: a?.signedCurrent, next: a?.nextMilestone, was: t.nextMilestone }));
const o1 = await owedOf(empId, t.instrumentId);
check("6. Competencies owed still counts the method as not assessed", !!o1 && o1.assessed === false, JSON.stringify(o1));

// pdfReport.ts loads server/db.ts, which opens DB_PATH (default /data/veritas.db): point it at a scratch file here.
process.env.DB_PATH = path.join(dir, "pdf-import.db");
const pdf = await import(new URL("../server/pdfReport.ts", import.meta.url).href).catch(() => null);
if (pdf?.buildEmployeeCompetencyRecordHTML) {
  const v = await view(empId);
  const html = pdf.buildEmployeeCompetencyRecordHTML({ labName: "Michaels Lab", employee: v.employee, elementCount: v.elementCount, testSystems: v.testSystems });
  const signAt = html.indexOf("EVALUATOR SIGN-OFF BY METHOD"), remAt = html.indexOf("<h2>Remediation</h2>");
  check("7. the record PDF shows Remediation required and the plan, below the sign-off block",
    /Remediation required/.test(html) && /Retrain on gel card reading/.test(html) && signAt > 0 && remAt > signAt, `sign ${signAt} remediation ${remAt}`);
} else console.log("SKIP  7. run with tsx to check the PDF body (node cannot import server/pdfReport.ts)");

// Reassessment: enter the same element data again (the reassessment after remediation), then sign Pass.
const save = await fetch(`${B}/employee/${empId}/test-system/${t.instrumentId}`, {
  method: "PUT", headers: H,
  body: JSON.stringify(t.waived ? { waivedMethods: (t.waivedMethods || []).map((m) => ({ num: m.num, evidence: m.evidence, date: m.date, initials: m.initials, passed: m.passed })) } : { elements: t.elements }),
});
const r8 = await sign({ determination: "pass" });
const b = await methodOf(empId, t.instrumentId);
check("8. reassessed and signed Pass: current again, the next competency advances, the remediation stays in the history",
  save.status === 200 && r8.status === 200 && b?.lastSignoff?.determination === "pass" && b?.needsRemediation === false && b?.signedCurrent === true
    && b?.nextMilestone !== t.nextMilestone && b?.signoffs?.[1]?.determination === "remediation",
  JSON.stringify({ save: save.status, sign: r8.status, det: b?.lastSignoff?.determination, current: b?.signedCurrent, next: b?.nextMilestone, history: (b?.signoffs || []).map((x) => x.determination) }));
const o2 = await owedOf(empId, t.instrumentId);
check("9. Competencies owed now counts the method assessed", !!o2 && o2.assessed === true, JSON.stringify(o2));

await done();
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS"); process.exit(fails ? 1 : 0);
