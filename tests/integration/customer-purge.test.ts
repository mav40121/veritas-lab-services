// tests/integration/customer-purge.test.ts
//
// Michael 2026-11-13, Q313 = 1: delete one customer's data (server/customerPurge.ts, POST /api/admin/customer-purge).
// Made-up customers on a fresh database, with stored files in a scratch folder. It checks:
//   1. every table in the database has a purge rule; a new table with none makes the plan refuse
//   2. the route refuses without the admin header and with a bad target
//   3. a demo lab, a Veritas owner, an owner whose lab sits in an organization with another owner's lab, and an
//      unknown account are refused
//   4. the dry run writes nothing and says what goes and what stays: the customer's labs and organization, three people
//      deleted, and one kept for each reason (a member elsewhere, a Veritas login, a person another lab's records name)
//   5. applying needs CUSTOMER_PURGE_ENABLED=1, the confirm phrase and the dry run's count; each refusal changes nothing
//   6. applying deletes exactly the planned rows of every table and nothing else; another customer's rows, people and
//      files are untouched; references from rows that stay are cleared; the stored files and folders go; one audit row
//      of counts with no names; foreign keys check clean; secure_delete is put back
//   7. a failed apply rolls back whole
//   8. purging by organization takes every lab in it
// Run: rm -f .tmp-customerpurge.db && DB_PATH=.tmp-customerpurge.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/customer-purge.test.ts
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), "customer-purge-"));
process.env.POLICY_STORAGE_ROOT = path.join(SCRATCH, "policies");
process.env.EXPORT_ALL_DIR = path.join(SCRATCH, "exports");
delete process.env.CUSTOMER_PURGE_ENABLED;

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const purge = await import("../../server/customerPurge");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  let fillSeq = 0;
  const colsOf = (t: string) => sqlite.prepare(`PRAGMA table_info("${t}")`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const cols = colsOf(table);
    const names = new Set(cols.map((c) => c.name));
    for (const k of Object.keys(values)) if (!names.has(k)) throw new Error(`${table} has no column ${k}`);
    const row: Record<string, unknown> = { ...values };
    for (const c of cols) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-13T00:00:00Z" : /count|_id$|is_|number|^expires$/i.test(c.name) ? 1 : `made-up-${++fillSeq}`;
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const user = (email: string) => insert("users", { email, name: "Made-up Person", plan: "hospital", seat_count: 0 });
  const writeFile = (abs: string) => { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, "made-up file"); return abs; };

  // db.ts seeds the demo VeritaStaff lab for user 1 (the demo account on production), so user 1 here is a stand-in.
  user("stand-in-user-one@example.test");
  // Customer A: two labs in one organization. Customer B: one lab. C and D share an organization. E has a demo lab, V is ours.
  const aOwner = user("a-owner@example.test"), aStaff = user("a-staff@example.test"), aTech = user("a-tech@example.test");
  const shared = user("shared-person@example.test"), vSupport = user("support-purge@veritaslabservices.com"), named = user("named-elsewhere@example.test");
  const bOwner = user("b-owner@example.test"), bMember = user("b-member@example.test");
  const cOwner = user("c-owner@example.test"), dOwner = user("d-owner@example.test"), eOwner = user("e-owner@example.test"), vOwner = user("owner-purge@veritaslabservices.com");
  const orgA = insert("organizations", { name: "Made-up System A", billing_owner_user_id: aOwner });
  const orgC = insert("organizations", { name: "Made-up System C", billing_owner_user_id: cOwner });
  let cliaSeq = 0;
  const lab = (owner: number, org: number | null, demo = 0) => insert("labs", { lab_name: `Made-up Lab ${owner}-${++cliaSeq}`, owner_user_id: owner, plan: "hospital", organization_id: org, is_demo: demo, clia_number: `00D00000${String(cliaSeq).padStart(2, "0")}` });
  const A1 = lab(aOwner, orgA), A2 = lab(aOwner, orgA), B1 = lab(bOwner, null);
  const C1 = lab(cOwner, orgC), D1 = lab(dOwner, orgC), E1 = lab(eOwner, null, 1), V1 = lab(vOwner, null);
  insert("organization_members", { organization_id: orgA, user_id: aOwner, org_role: "org_owner", status: "active" });
  insert("organization_members", { organization_id: orgA, user_id: aTech, org_role: "org_admin", status: "active" });
  insert("organization_billing_line_items", { organization_id: orgA, lab_id: A1 });
  const member = (labId: number, userId: number, role = "member") => insert("lab_members", { lab_id: labId, user_id: userId, role, status: "active", is_primary_lab: 0 });
  member(A1, aOwner, "owner"); member(A1, aStaff, "staff"); member(A2, aTech, "admin"); member(A1, shared); member(B1, shared);
  member(A1, vSupport, "admin"); member(A1, named); member(B1, bOwner, "owner"); member(B1, bMember);
  insert("user_seats", { owner_user_id: aOwner, lab_id: A1, seat_email: "a-staff@example.test", seat_user_id: aStaff, seat_type: "staff_portal", status: "active" });
  insert("user_seats", { owner_user_id: aOwner, lab_id: null, seat_email: "a-tech@example.test", seat_user_id: aTech, seat_type: "active", status: "active" });
  insert("user_seats", { owner_user_id: bOwner, lab_id: B1, seat_email: "b-member@example.test", seat_user_id: bMember, seat_type: "active", status: "active" });
  sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(A1, A1, shared);
  insert("user_sessions", { user_id: aStaff }); insert("user_sessions", { user_id: bMember });
  insert("user_mfa", { user_id: aTech });
  insert("password_history", { user_id: aOwner });
  insert("terms_acceptances", { user_id: aStaff, account_email: "a-staff@example.test" });
  const invoice = insert("invoice_requests", { user_id: aOwner, billing_contact_email: "ap@example.test" });
  insert("newsletter_subscribers", { email: "a-tech@example.test" });
  insert("lab_audit_log", { lab_id: B1, changed_by_user_id: named });
  insert("lab_audit_log", { lab_id: A1, changed_by_user_id: aOwner });
  const bCustom = insert("veritascan_custom_items", { lab_id: B1, created_by_user_id: aTech });
  insert("veritascan_custom_items", { lab_id: A1, created_by_user_id: aOwner });
  const aStudy = insert("studies", { lab_id: A1, user_id: aOwner, test_name: "Made-up A" });
  insert("studies", { lab_id: null, user_id: aOwner, test_name: "Made-up A legacy" });
  const bStudy = insert("studies", { lab_id: B1, user_id: bOwner, test_name: "Made-up B" });
  const bLegacy = insert("studies", { lab_id: null, user_id: bOwner, test_name: "Made-up B legacy" });
  const aMap = insert("veritamap_maps", { lab_id: A2, user_id: aOwner, name: "Made-up map A" });
  insert("veritamap_instruments", { map_id: aMap });
  const bMap = insert("veritamap_maps", { lab_id: B1, user_id: bOwner, name: "Made-up map B" });
  insert("veritamap_instruments", { map_id: bMap });
  const aStaffLab = insert("staff_labs", { user_id: aOwner, tier2_lab_id: A1, lab_name: "Made-up A", clia_number: "00D0000000" });
  const bStaffLab = insert("staff_labs", { user_id: bOwner, tier2_lab_id: B1, lab_name: "Made-up B", clia_number: "00D0000001" });
  const aEmp = insert("staff_employees", { lab_id: aStaffLab, tier2_lab_id: A1, user_id: aOwner, first_name: "Made", last_name: "Up", status: "active" });
  const bEmp = insert("staff_employees", { lab_id: bStaffLab, tier2_lab_id: B1, user_id: bOwner, first_name: "Made", last_name: "Up", status: "active" });
  insert("staff_roles", { employee_id: aEmp, lab_id: aStaffLab, role: "TP" });
  insert("staff_roles", { employee_id: bEmp, lab_id: bStaffLab, role: "TP" });
  const root = process.env.POLICY_STORAGE_ROOT!;
  const aDoc = insert("policy_documents", { lab_id: A1, title: "Made-up A doc" });
  const bDoc = insert("policy_documents", { lab_id: B1, title: "Made-up B doc" });
  insert("policy_versions", { document_id: aDoc, version_number: 1, file_path: `${A1}/${aDoc}/v1/document.pdf` });
  insert("policy_versions", { document_id: bDoc, version_number: 1, file_path: `${B1}/${bDoc}/v1/document.pdf` });
  const aFile = writeFile(path.join(root, String(A1), String(aDoc), "v1", "document.pdf"));
  const bFile = writeFile(path.join(root, String(B1), String(bDoc), "v1", "document.pdf"));
  insert("policy_carried_records", { lab_id: A1, document_id: aDoc, face_page_path: `${A1}/${aDoc}/carried/face.html` });
  const aFace = writeFile(path.join(root, String(A1), String(aDoc), "carried", "face.html"));
  const legacyName = `policy_${aOwner}_purgetest_${Date.now()}.pdf`;
  insert("veritapolicy_lab_policies", { user_id: aOwner, lab_id: A1, policy_name: "Made-up legacy", document_path: legacyName });
  const aLegacyFile = writeFile(path.join(process.cwd(), "uploads", "policies", legacyName));
  const aExport = writeFile(path.join(process.env.EXPORT_ALL_DIR!, `lab-${A1}`, "0123456789abcdef01234567.zip"));
  const bExport = writeFile(path.join(process.env.EXPORT_ALL_DIR!, `lab-${B1}`, "0123456789abcdef01234568.zip"));
  insert("pi_departments", { account_id: aOwner, name: "Made-up A dept" });
  const bDept = insert("pi_departments", { account_id: bOwner, name: "Made-up B dept" });
  insert("audit_log", { user_id: aOwner, owner_user_id: aOwner, module: "account", action: "update", entity_type: "made_up" });
  const bAudit = insert("audit_log", { user_id: bOwner, owner_user_id: bOwner, module: "account", action: "update", entity_type: "made_up" });
  insert("record_views", { lab_id: A1, user_id: aStaff }); insert("record_views", { lab_id: B1, user_id: bMember });
  insert("inventory_transfers", { from_lab_id: A1, to_lab_id: A2, owner_user_id: aOwner });
  insert("nightly_snapshots", { user_id: aOwner, snapshot_date: "2026-11-12" });
  insert("nightly_snapshots", { user_id: bOwner, snapshot_date: "2026-11-12" });

  const fkProblems = () => (sqlite.prepare("PRAGMA foreign_key_check").all() as any[]).length;
  check("setup: the made-up data has no foreign key problems", fkProblems() === 0, JSON.stringify(sqlite.prepare("PRAGMA foreign_key_check").all().slice(0, 5)));

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const post = async (body: unknown, hdr = true) => {
    const r = await fetch(`${base}/api/admin/customer-purge`, { method: "POST", headers: { "Content-Type": "application/json", ...(hdr ? { "x-admin-secret": process.env.ADMIN_SECRET || "" } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, j: await r.json().catch(() => ({})) as any };
  };
  const tables = () => (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as any[]).map((r) => r.name as string);
  const counts = () => Object.fromEntries(tables().map((t) => [t, Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n)]));
  const exists = (t: string, id: number) => !!sqlite.prepare(`SELECT 1 FROM "${t}" WHERE id = ?`).get(id);

  try {
    // 1. Every table has a rule.
    check("1. every table in the database has a purge rule", purge.unruledTables(sqlite).length === 0, purge.unruledTables(sqlite).join(", "));
    sqlite.exec("CREATE TABLE made_up_unruled (id INTEGER PRIMARY KEY, lab_id INTEGER)");
    const unruled = await post({ ownerUserId: aOwner });
    check("1. a new table with no rule makes the plan refuse", unruled.status === 409 && unruled.j.code === "UNCLASSIFIED_TABLES" && unruled.j.detail?.tables?.includes("made_up_unruled"), JSON.stringify(unruled.j));
    sqlite.exec("DROP TABLE made_up_unruled");
    // Production's database also holds Litestream's own tables (backup bookkeeping); they need no rule and are never touched.
    sqlite.exec("CREATE TABLE IF NOT EXISTS _litestream_seq (id INTEGER PRIMARY KEY, seq INTEGER)");
    sqlite.exec("CREATE TABLE IF NOT EXISTS _litestream_lock (id INTEGER)");
    check("1. Litestream's tables need no rule and are left out of the plan", purge.unruledTables(sqlite).length === 0 && !purge.appTables(sqlite).some((t: string) => t.startsWith("_litestream_")), purge.unruledTables(sqlite).join(", "));

    // 2. Header and target.
    const noHdr = await post({ ownerUserId: aOwner }, false);
    const both = await post({ ownerUserId: aOwner, organizationId: orgA });
    const none = await post({});
    const str = await post({ ownerUserId: String(aOwner) });
    check("2. refuses without the admin header", noHdr.status === 403, String(noHdr.status));
    check("2. a target must be exactly one positive integer", [both, none, str].every((r) => r.status === 400 && r.j.code === "BAD_TARGET"), [both, none, str].map((r) => r.status).join(" "));

    // 3. Refusals.
    const demo = await post({ ownerUserId: eOwner });
    const ours = await post({ ownerUserId: vOwner });
    const span = await post({ ownerUserId: cOwner });
    const unknown = await post({ ownerUserId: 999999 });
    check("3. a demo lab is refused", demo.status === 400 && demo.j.code === "PROTECTED_ACCOUNT" && demo.j.detail?.demoLabIds?.[0] === E1, JSON.stringify(demo.j));
    check("3. a Veritas owner is refused", ours.status === 400 && ours.j.code === "PROTECTED_ACCOUNT", JSON.stringify(ours.j));
    check("3. an owner whose organization holds another owner's lab is refused", span.status === 409 && span.j.code === "ORG_HAS_OTHER_LABS" && span.j.detail?.labIds?.[0] === D1, JSON.stringify(span.j));
    check("3. an unknown account is 404", unknown.status === 404, String(unknown.status));
    void V1; void C1;

    // 4. Dry run.
    const before = counts();
    const dry = await post({ ownerUserId: aOwner });
    const p = dry.j;
    check("4. the dry run answers and writes nothing", dry.status === 200 && p.dryRun === true && JSON.stringify(counts()) === JSON.stringify(before), JSON.stringify(p).slice(0, 400));
    check("4. ... its labs and organization are the customer's", JSON.stringify(p.labs?.map((l: any) => l.id)) === JSON.stringify([A1, A2]) && JSON.stringify(p.organizationIds) === JSON.stringify([orgA]) && JSON.stringify(p.staffLabIds) === JSON.stringify([aStaffLab]), JSON.stringify({ labs: p.labs, orgs: p.organizationIds, staff: p.staffLabIds }));
    check("4. ... three people go; one kept as a member elsewhere, one as a Veritas login, one named by another lab's records",
      p.people?.delete === 3 && p.people?.keep === 3 && p.people?.keepReasons?.memberElsewhere === 1 && p.people?.keepReasons?.veritasLogin === 1 && p.people?.keepReasons?.referencedElsewhere === 1, JSON.stringify(p.people));
    check("4. ... references from rows that stay are cleared, not deleted",
      p.detach?.["users.lab_id"] === 1 && p.detach?.["users.default_lab_id"] === 1 && p.detach?.["invoice_requests.user_id"] === 1 && p.detach?.["veritascan_custom_items.created_by_user_id"] === 1, JSON.stringify(p.detach));
    check("4. ... it names what Veritas keeps for these people", p.retainedForPeople?.terms_acceptances?.rows === 1 && p.retainedForPeople?.newsletter_subscribers?.rows === 1 && p.retainedForPeople?.invoice_requests?.rows === 1, JSON.stringify(p.retainedForPeople));
    check("4. ... three stored files and the labs' folders", p.files?.count === 3 && p.files?.folders === 4, JSON.stringify(p.files));
    check("4. ... the confirm phrase and that applying is off here", p.confirmPhrase === `DELETE CUSTOMER owner-${aOwner}` && p.applyEnabled === false, `${p.confirmPhrase} ${p.applyEnabled}`);
    const want: Record<string, number> = { labs: 2, users: 3, studies: 2, staff_labs: 1, staff_employees: 1, staff_roles: 1, policy_documents: 1, policy_versions: 1, pi_departments: 1, audit_log: 1, organizations: 1, organization_members: 2, nightly_snapshots: 1, user_sessions: 1, user_mfa: 1, password_history: 1, inventory_transfers: 1 };
    const wrong = Object.entries(want).filter(([t, n]) => p.rowsByTable?.[t] !== n);
    check("4. ... the rows by table are the customer's", wrong.length === 0, JSON.stringify(wrong.map(([t, n]) => `${t}: want ${n} got ${p.rowsByTable?.[t]}`)));

    // 5. Apply guards.
    const off = await post({ ownerUserId: aOwner, dryRun: false, expectedTotal: p.totalRows, confirm: p.confirmPhrase });
    process.env.CUSTOMER_PURGE_ENABLED = "1";
    const noConfirm = await post({ ownerUserId: aOwner, dryRun: false, expectedTotal: p.totalRows, confirm: "yes" });
    const wrongCount = await post({ ownerUserId: aOwner, dryRun: false, expectedTotal: p.totalRows + 1, confirm: p.confirmPhrase });
    check("5. applying is refused unless the server turns it on", off.status === 403 && off.j.code === "PURGE_DISABLED", JSON.stringify(off.j).slice(0, 200));
    check("5. ... without the confirm phrase", noConfirm.status === 400 && noConfirm.j.code === "CONFIRM_REQUIRED", String(noConfirm.status));
    check("5. ... with a count that isn't the dry run's", wrongCount.status === 409 && wrongCount.j.code === "COUNT_CHANGED", String(wrongCount.status));
    check("5. ... and none of those changed anything", JSON.stringify(counts()) === JSON.stringify(before));

    // 7 (before 6). A failed apply rolls back whole: tamper a plan so it deletes one row more than planned.
    const planned = purge.planCustomerPurge(sqlite, { ownerUserId: aOwner }) as any;
    const tampered = { ...planned.internal, rowids: { ...planned.internal.rowids, studies: [...planned.internal.rowids.studies, bStudy] } };
    let threw = false;
    try { purge.applyCustomerPurge(sqlite, planned.plan, tampered); } catch { threw = true; }
    check("7. a failed apply throws and rolls back whole", threw && JSON.stringify(counts()) === JSON.stringify(before) && fs.existsSync(aFile));

    // 6. Apply.
    const bPlanBefore = (purge.planCustomerPurge(sqlite, { ownerUserId: bOwner }) as any).plan;
    sqlite.pragma("foreign_keys = ON");
    const secureBefore = sqlite.pragma("secure_delete", { simple: true });
    const go = await post({ ownerUserId: aOwner, dryRun: false, expectedTotal: p.totalRows, confirm: p.confirmPhrase });
    const after = counts();
    check("6. applying deletes the planned rows", go.status === 200 && go.j.applied === true && go.j.deletedRows === p.totalRows, JSON.stringify(go.j).slice(0, 300));
    const off6 = tables().filter((t) => t !== "audit_log" && (before[t] ?? 0) - (after[t] ?? 0) !== (p.rowsByTable[t] ?? 0));
    check("6. ... exactly the planned rows of every table, nothing else", off6.length === 0 && (before.audit_log - after.audit_log) === p.rowsByTable.audit_log - 1, JSON.stringify(off6.map((t) => `${t}: ${before[t]}->${after[t]} planned ${p.rowsByTable[t] ?? 0}`)));
    const bPlanAfter = (purge.planCustomerPurge(sqlite, { ownerUserId: bOwner }) as any).plan;
    const identity = new Set(["users", "lab_members", "user_seats", "user_sessions", "organization_members"]);
    const bDiff = Object.keys({ ...bPlanBefore.rowsByTable, ...bPlanAfter.rowsByTable }).filter((t) => !identity.has(t) && bPlanBefore.rowsByTable[t] !== bPlanAfter.rowsByTable[t]);
    check("6. ... the other customer's records are all still there", bDiff.length === 0 && exists("studies", bStudy) && exists("studies", bLegacy) && exists("pi_departments", bDept) && exists("audit_log", bAudit) && exists("labs", B1), JSON.stringify(bDiff));
    const gone = [aOwner, aStaff, aTech].filter((u) => exists("users", u));
    check("6. ... the customer's people are gone, with their sign-in rows", gone.length === 0 && !sqlite.prepare("SELECT 1 FROM user_sessions WHERE user_id = ?").get(aStaff) && !sqlite.prepare("SELECT 1 FROM user_mfa WHERE user_id = ?").get(aTech), JSON.stringify(gone));
    const sharedRow = sqlite.prepare("SELECT lab_id, default_lab_id FROM users WHERE id = ?").get(shared) as any;
    const sharedLabs = (sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ?").all(shared) as any[]).map((r) => r.lab_id);
    check("6. ... a person who belongs elsewhere stays, keeps that lab and loses this one", !!sharedRow && sharedRow.lab_id === null && sharedRow.default_lab_id === null && JSON.stringify(sharedLabs) === JSON.stringify([B1]), JSON.stringify({ sharedRow, sharedLabs }));
    check("6. ... the Veritas login and the person another lab names stay", exists("users", vSupport) && exists("users", named) && !sqlite.prepare("SELECT 1 FROM lab_members WHERE user_id = ? AND lab_id = ?").get(vSupport, A1), "");
    check("6. ... another customer's people and seats stay", exists("users", bOwner) && exists("users", bMember) && !!sqlite.prepare("SELECT 1 FROM user_sessions WHERE user_id = ?").get(bMember) && !!sqlite.prepare("SELECT 1 FROM user_seats WHERE seat_user_id = ?").get(bMember));
    const inv = sqlite.prepare("SELECT user_id FROM invoice_requests WHERE id = ?").get(invoice) as any;
    const custom = sqlite.prepare("SELECT created_by_user_id FROM veritascan_custom_items WHERE id = ?").get(bCustom) as any;
    check("6. ... Veritas's records stay with the reference cleared", !!inv && inv.user_id === null && !!custom && custom.created_by_user_id === null && !!sqlite.prepare("SELECT 1 FROM terms_acceptances WHERE user_id = ?").get(aStaff), JSON.stringify({ inv, custom }));
    check("6. ... the organization and its rows are gone", !exists("organizations", orgA) && !sqlite.prepare("SELECT 1 FROM organization_billing_line_items WHERE organization_id = ?").get(orgA) && exists("organizations", orgC));
    check("6. ... the stored files and folders are gone", !fs.existsSync(aFile) && !fs.existsSync(aFace) && !fs.existsSync(aLegacyFile) && !fs.existsSync(aExport) && !fs.existsSync(path.join(root, String(A1))) && go.j.files?.deleted === 3, JSON.stringify(go.j.files));
    check("6. ... the other customer's files stay", fs.existsSync(bFile) && fs.existsSync(bExport));
    const auditRow = sqlite.prepare("SELECT * FROM audit_log WHERE id = ?").get(go.j.auditId) as any;
    check("6. ... one audit row of counts, no names or addresses", !!auditRow && auditRow.entity_type === "customer_purge" && auditRow.entity_id === `owner-${aOwner}` && auditRow.owner_user_id === 0 && !/@|Made-up/.test(String(auditRow.after_json)) && JSON.parse(auditRow.after_json).deletedRows === p.totalRows, String(auditRow?.after_json).slice(0, 200));
    check("6. ... foreign keys check clean", fkProblems() === 0, JSON.stringify(sqlite.prepare("PRAGMA foreign_key_check").all().slice(0, 5)));
    check("6. ... secure_delete is put back", sqlite.pragma("secure_delete", { simple: true }) === secureBefore, `${secureBefore}`);
    const again = await post({ ownerUserId: aOwner });
    check("6. ... the customer no longer exists for a second dry run", again.status === 404, String(again.status));

    // 8. By organization.
    const byOrg = await post({ organizationId: orgC });
    check("8. purging by organization takes every lab in it", byOrg.status === 200 && JSON.stringify(byOrg.j.labs?.map((l: any) => l.id)) === JSON.stringify([C1, D1]) && byOrg.j.confirmPhrase === `DELETE CUSTOMER org-${orgC}`, JSON.stringify(byOrg.j).slice(0, 300));
  } finally {
    delete process.env.CUSTOMER_PURGE_ENABLED;
    server.close();
    try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* ignore */ }
    try { if (fs.existsSync(aLegacyFile)) fs.unlinkSync(aLegacyFile); } catch { /* ignore */ }
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
