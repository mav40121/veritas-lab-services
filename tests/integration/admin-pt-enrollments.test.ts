// tests/integration/admin-pt-enrollments.test.ts
//
// REQ-143 (2026-11-10): GET /api/admin/labs/:labId/pt-enrollments reads one lab's VeritaPT enrollment record without a
// lab-scoped GET, which would write a record_views row on the client's access log. Made-up users, labs and enrollments
// on a fresh database. It checks:
//   1. the route refuses without the admin header, and with the secret only in the query string
//   2. a bad or unknown lab id is 400 / 404
//   3. it returns this lab's discipline rows (pt_enrollments_v2) and analyte rows (pt_enrollments), newest year first,
//      with the per vendor-and-year count, and never another lab's rows
//   4. no user ids, names or emails in the answer
//   5. it writes nothing: row counts of the enrollment tables and record_views before and after
// Run: rm -f .tmp-ptenroll.db && DB_PATH=.tmp-ptenroll.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/admin-pt-enrollments.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const owner = insert("users", { email: "owner-ptenroll@example.test", name: "Made-up Owner", plan: "community", seat_count: 0 });
  const other = insert("users", { email: "other-ptenroll@example.test", name: "Made-up Other", plan: "community", seat_count: 0 });
  const lab = insert("labs", { lab_name: "Made-up PT Lab", owner_user_id: owner, plan: "community" });
  const lab2 = insert("labs", { lab_name: "Made-up Sister Lab", owner_user_id: other, plan: "community" });
  const v2 = (labId: number, user: number, vendor: string, program: string, cat: string, year: number) =>
    insert("pt_enrollments_v2", { user_id: user, lab_id: labId, vendor, program_name: program, pt_category: cat, year_enrolled: year });
  v2(lab, owner, "API", "Chemistry Core", "General Chemistry", 2026);
  v2(lab, owner, "API", "Hematology / Coagulation", "Hematology", 2026);
  v2(lab, owner, "CAP", "CZ", "General Chemistry", 2027);
  v2(lab2, other, "CAP", "Other lab's program", "Hematology", 2027);
  insert("pt_enrollments", { user_id: owner, lab_id: lab, analyte: "Glucose", specialty: "General Chemistry", pt_provider: "API", program_code: "Made-up 1", enrollment_year: 2026, enrollment_date: "2026-01-05", status: "active" });
  insert("pt_enrollments", { user_id: other, lab_id: lab2, analyte: "Sodium", specialty: "General Chemistry", pt_provider: "CAP", program_code: "Made-up 2", enrollment_year: 2026, enrollment_date: "2026-01-05", status: "active" });

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const secret = process.env.ADMIN_SECRET || "";
  const hdr = { headers: { "x-admin-secret": secret } };
  const tables = ["pt_enrollments", "pt_enrollments_v2", "record_views"];
  const counts = () => tables.map((t) => { try { return (sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as any).n; } catch { return "none"; } }).join(",");
  try {
    const no = await fetch(`${base}/api/admin/labs/${lab}/pt-enrollments`);
    const q = await fetch(`${base}/api/admin/labs/${lab}/pt-enrollments?secret=${encodeURIComponent(secret)}`);
    check("1. refuses without the admin header, and with the secret only in the query", no.status === 403 && q.status === 403, `${no.status} ${q.status}`);
    const bad = await fetch(`${base}/api/admin/labs/abc/pt-enrollments`, hdr);
    const unknown = await fetch(`${base}/api/admin/labs/999999/pt-enrollments`, hdr);
    check("2. a bad lab id is 400 and an unknown one 404", bad.status === 400 && unknown.status === 404, `${bad.status} ${unknown.status}`);
    const before = counts();
    const r = await fetch(`${base}/api/admin/labs/${lab}/pt-enrollments`, hdr);
    const j: any = await r.json();
    check("3. this lab's three discipline rows, newest year first", r.status === 200 && j.disciplineCount === 3 && j.disciplines?.[0]?.year_enrolled === 2027 && j.disciplines?.[0]?.vendor === "CAP", JSON.stringify(j.disciplines));
    check("3. ... counted by vendor and year", j.byVendorYear?.["API 2026"] === 2 && j.byVendorYear?.["CAP 2027"] === 1 && Object.keys(j.byVendorYear || {}).length === 2, JSON.stringify(j.byVendorYear));
    check("3. ... its one analyte row", j.analyteCount === 1 && j.analytes?.[0]?.analyte === "Glucose", JSON.stringify(j.analytes));
    check("3. ... and nothing from the other lab", !/Other lab's program|Sodium/.test(JSON.stringify(j)));
    check("4. no user ids, names or emails", !/user_id|@|Made-up Owner|Made-up Other/.test(JSON.stringify(j)));
    const after = counts();
    check("5. it writes nothing (enrollment tables and record_views)", before === after, `${before} -> ${after}`);
  } finally {
    server.close();
  }
  console.log(failed ? `${failed} FAILED` : "ALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
