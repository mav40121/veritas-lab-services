// scripts/verify-verification-study-pdfs.mts
//
// PDF receipt for B4 (2026-11-27; server/verificationSignatures.ts, server/pdfReport.ts directorReviewHTML). Renders page 1 of
// four made-up studies on a scratch DB and checks the LABORATORY DIRECTOR OR DESIGNEE REVIEW block on each:
//   P1. signed now, Accepted: the signer's choice marked, "(electronically signed)", the title, and how it was signed
//   P2. signed now by a designee, Not accepted: Not accepted marked, as the designee
//   P3. signed before name-and-password signing, passing: Accepted marked exactly as main prints it, with the line saying it was
//       recorded with a typed name and no password, never "electronically signed" (B4 review)
//   P4. signed before, failing: no box marked, as main prints it
// Each signature is on page 1. Writes study_*.pdf to OUT. Needs PyMuPDF (python -E, fitz).
// Run: DB_PATH=<scratch db> OUT=<dir> JWT_SECRET=x ADMIN_SECRET=x STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/verify-verification-study-pdfs.mts
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const { db } = await import("../server/db");
const { buildStudyPdf } = await import("../server/studyPdf");
const sqlite = (db as any).$client;
const OUT = process.env.OUT || ".";
const now = new Date().toISOString();
let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const seed = (table: string, values: Record<string, any>): number => {
  const row: Record<string, any> = { ...values };
  for (const c of sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
    if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = /_at$/.test(c.name) ? now : /INT|REAL/.test(String(c.type)) ? 0 : "x";
  }
  const cols = Object.keys(row);
  return Number(sqlite.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((k) => row[k])).lastInsertRowid);
};
const owner = seed("users", { email: `vspdf-${Date.now()}@example.test`, name: "Avery Owner", password_hash: "x", plan: "hospital" });
const lab = seed("labs", { lab_name: "Example Hospital Laboratory", owner_user_id: owner, plan: "hospital", clia_number: "00D0000000", created_at: now, updated_at: now });
const points = JSON.stringify([[120, 121], [140, 139], [160, 161]].map(([e, s], i) => ({ level: i + 1, expectedValue: e, instrumentValues: { "CH-500 Chemistry": s } })));
const study = (more: Record<string, any>) => seed("studies", {
  user_id: owner, lab_id: lab, test_name: "Glucose", instrument: "CH-500 Chemistry", analyst: "Ann Alyst", date: "2026-06-01", study_type: "cal_ver",
  clia_allowable_error: 4, tea_is_percentage: 0, tea_unit: "mmol/L", data_points: points, instruments: '["CH-500 Chemistry"]', status: "pass",
  lifecycle_state: "finalized", finalized_at: "2026-06-02T15:00:00.000Z", finalized_by_user_id: owner, created_at: now, ...more,
});
const cases = [
  ["study_signed_now_accepted", study({ finalized_signature: "Jordan Ellis, MD", finalized_decision: "accepted", signed_with: "password", finalized_capacity: "medical_director", finalized_capacity_label: "Medical director", finalized_title: "Medical director" })],
  ["study_signed_now_not_accepted", study({ finalized_signature: "Casey Consultant", finalized_decision: "not_accepted", signed_with: "password", finalized_capacity: "designee", finalized_capacity_label: "Designee, Technical Consultant (moderate complexity)", finalized_title: "Designee, Technical Consultant (moderate complexity)" })],
  ["study_signed_before_pass", study({ finalized_signature: "MV" })],
  ["study_signed_before_fail", study({ finalized_signature: "MV", status: "fail" })],
] as const;

const labRow = sqlite.prepare("SELECT * FROM labs WHERE id = ?").get(lab);
const ownerRow = sqlite.prepare("SELECT * FROM users WHERE id = ?").get(owner);
const page1: Record<string, string> = {};
fs.mkdirSync(OUT, { recursive: true });
for (const [name, id] of cases) {
  const { buffer } = await buildStudyPdf(sqlite, sqlite.prepare("SELECT * FROM studies WHERE id = ?").get(id), labRow, ownerRow);
  const file = path.join(OUT, `${name}.pdf`);
  fs.writeFileSync(file, buffer);
  page1[name] = execFileSync("python", ["-E", "-c", "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(fitz.open(sys.argv[1])[0].get_text())", file]).toString("utf-8").replace(/\s+/g, " ");
}
const block = (t: string) => t.slice(t.search(/LABORATORY DIRECTOR OR DESIGNEE REVIEW/i));
const [p1, p2, p3, p4] = cases.map(([n]) => block(page1[n]));
check("P1. signed now: Accepted marked, electronically signed, the title, and how, on page 1", /☑ Accepted for patient testing/.test(p1) && /\(electronically signed\)/.test(p1) && /Signed in VeritaCheck® with name and password, as the medical director\./.test(p1), p1.slice(0, 500));
check("P2. a designee's Not accepted is marked as chosen, on page 1", /☑ Not accepted/.test(p2) && !/☑ Accepted/.test(p2) && /as a designee, Technical Consultant \(moderate complexity\)/.test(p2), p2.slice(0, 500));
check("P3. a passing study signed before: Accepted marked as main prints it, recorded with a typed name, never electronically signed, on page 1", /☑ Accepted for patient testing/.test(p3) && /typed, not a password signature/.test(p3) && /Recorded in VeritaCheck® on 2026-06-0\d with a typed name and no password or role check/.test(p3) && !/electronically signed/.test(p3), p3.slice(0, 500));
check("P4. a failing study signed before: no box marked, as main prints it", !/☑/.test(p4) && /Recorded in VeritaCheck®/.test(p4) && !/electronically signed/.test(p4), p4.slice(0, 500));
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
