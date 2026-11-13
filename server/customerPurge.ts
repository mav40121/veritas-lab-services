// server/customerPurge.ts
//
// Delete one customer's data (Michael 2026-11-13, Q313 = 1: Lifepoint's section 7.5 asks how personal information is
// destroyed at the end of the contract, and until now nothing could remove a populated customer). A customer is either
// an owner account (every lab it owns) or an organization (every lab in it). What belongs to the customer is what
// "Download all of this lab's records" hands back (server/exportAllTables.ts, whose test fails when a table is left
// unclassified), widened to the customer's people: their accounts, sign-in rows, memberships and seats. Every table
// excluded from the export has its own rule here (PURGE_EXCLUDED), so a new table can't slip past either.
//
// The plan is computed first and is the dry run; applying it is one transaction that deletes exactly the planned rows
// (by rowid, captured before anything is deleted), clears references to them from rows that stay (only nullable
// columns; a NOT NULL reference refuses the plan), checks that nothing left points at a deleted row, and writes one
// audit row of counts. Deleted pages are zeroed (PRAGMA secure_delete) and the WAL is checkpointed, so the rows don't
// survive in free pages of the database file. Stored files (policy document versions, carried-over face pages and
// originals, legacy policy uploads, export zips) are removed after the commit.
//
// Never deleted: a Veritas login (isVeritasLogin), a demo lab, a person who belongs anywhere outside the customer, and
// Veritas's own records (terms acceptances, invoices requested, contact and newsletter rows, monitoring); the plan
// counts those of the customer's people so the answer to the customer can name them. Backup copies made before the
// purge age out on the backup schedule; nothing here touches them.

import fs from "fs";
import path from "path";
import { EXPORT_TABLES, TRANSIENT_TABLE } from "./exportAllTables";
import { introspect, type FkEdge } from "./labReset";
import { isVeritasLogin } from "./labSeats";
import { POLICY_STORAGE_ROOT, resolveVersionFilePath } from "./veritapolicyApproval";
import { exportDir } from "./exportAll";

type Sqlite = any;

// ── Rules ────────────────────────────────────────────────────────────────────────────────────────────────────────
// Parameters every WHERE may use (JSON arrays, read through json_each):
//   @labs        the customer's labs (labs.id)
//   @orgs        the customer's organizations
//   @staffLabs   the customer's VeritaStaff labs (staff_labs.id)
//   @accounts    the customer's owner accounts plus every person being deleted (owner-keyed data)
//   @people      the people being deleted (users.id)
//   @now         Date.now(), for expired rows

const IN = (p: string) => `IN (SELECT value FROM json_each(@${p}))`;

export type PurgeRule =
  | { kind: "delete"; where: string }
  | { kind: "retain"; reason: string };

const del = (where: string): PurgeRule => ({ kind: "delete", where });
const retain = (reason: string): PurgeRule => ({ kind: "retain", reason });

const VLS_RECORD = "Veritas Lab Services business record (agreements, billing, inquiries, subscriptions); kept.";
const MONITORING = "Veritas system monitoring; holds no customer records.";
const REFERENCE = "Reference data that is the same for every lab.";
const DEMO_CALENDAR = "Veritas Lab Services demo-booking calendar, not the customer's records.";

/** Rules that replace the export's scope: identity tables reach the customer's people, not only its labs. */
export const PURGE_OVERRIDES: Record<string, PurgeRule> = {
  labs: del(`id ${IN("labs")}`),
  users: del(`id ${IN("people")}`),
  lab_members: del(`lab_id ${IN("labs")} OR user_id ${IN("people")}`),
  user_seats: del(`lab_id ${IN("labs")} OR owner_user_id ${IN("accounts")} OR seat_user_id ${IN("people")}`),
  staff_labs: del(`id ${IN("staffLabs")}`),
  inventory_transfers: del(`from_lab_id ${IN("labs")} OR to_lab_id ${IN("labs")}`),
};

/** A rule for every table the export leaves out. */
export const PURGE_EXCLUDED: Record<string, PurgeRule> = {
  user_sessions: del(`user_id ${IN("people")}`),
  pdf_tokens: del("expires < @now"), // short-lived download buffers with no owner column; expired ones go (the mint prunes them too)
  reset_tokens: del(`user_id ${IN("people")}`),
  mfa_email_codes: del(`user_id ${IN("people")}`),
  mfa_trusted_devices: del(`user_id ${IN("people")}`),
  user_mfa: del(`user_id ${IN("people")}`),
  user_mfa_recovery_codes: del(`user_id ${IN("people")}`),
  sso_handoffs: del(`user_id ${IN("people")}`),
  sso_login_states: retain("A sign-in in progress, kept minutes; holds no account id."),
  password_history: del(`user_id ${IN("people")}`),
  terms_acceptances: retain(VLS_RECORD),
  terms_activations: retain(VLS_RECORD),
  sso_configs: del(`organization_id ${IN("orgs")}`),
  system_security_settings: del(`owner_user_id ${IN("accounts")}`),
  organizations: del(`id ${IN("orgs")}`),
  organization_members: del(`organization_id ${IN("orgs")} OR user_id ${IN("people")}`),
  organization_billing_line_items: del(`organization_id ${IN("orgs")} OR lab_id ${IN("labs")}`),
  system_documents: del(`organization_id ${IN("orgs")}`),
  contact_messages: retain(VLS_RECORD),
  discount_codes: retain(VLS_RECORD),
  founding_lab_applications: retain(VLS_RECORD),
  invoice_requests: retain(VLS_RECORD),
  newsletter_subscribers: retain("A newsletter subscription the person made on their own; they can unsubscribe. Kept."),
  schedule_event_types: retain(DEMO_CALENDAR),
  schedule_availability_rules: retain(DEMO_CALENDAR),
  schedule_blackouts: retain(DEMO_CALENDAR),
  schedule_bookings: retain(DEMO_CALENDAR),
  backup_integrity_log: retain(MONITORING),
  csp_reports: retain(MONITORING),
  phi_scan_log: retain(MONITORING),
  continuous_backup_probe: retain(MONITORING),
  continuous_backup_checks: retain(MONITORING),
  nightly_snapshots: del(`user_id ${IN("accounts")}`),
  pt_vendor_programs: retain(REFERENCE),
  state_lab_licensure_registry: retain(REFERENCE),
};

/** The rule for one table, or null when it has none (the plan refuses then). */
export function purgeRule(table: string, depth = 0): PurgeRule | null {
  if (depth > 6) throw new Error(`customer-purge: parent chain too deep at ${table}`);
  if (PURGE_OVERRIDES[table]) return PURGE_OVERRIDES[table];
  const spec = EXPORT_TABLES[table];
  if (!spec) return null;
  const s = spec.scope;
  switch (s.kind) {
    case "lab": return del(`lab_id ${IN("labs")}`);
    case "labOrOwner": return del(`(lab_id ${IN("labs")} OR (lab_id IS NULL AND "${s.ownerColumn}" ${IN("accounts")}))`);
    case "owner": return del(`"${s.ownerColumn}" ${IN("accounts")}`);
    case "staffLab": return del(`lab_id ${IN("staffLabs")}`);
    case "child": {
      const parent = purgeRule(s.parent, depth + 1);
      if (!parent) return null;
      if (parent.kind === "retain") return retain(`Child of ${s.parent}, which is kept.`);
      return del(`"${s.column}" IN (SELECT id FROM "${s.parent}" WHERE ${parent.where})`);
    }
    case "sql": return null; // a hand-written lab clause; every one needs an override above
    case "exclude": return PURGE_EXCLUDED[table] ?? null;
  }
}

// SQLite's own tables, and the ones Litestream (server/continuousBackup.ts) keeps in production's database for its own
// bookkeeping; they hold no customer records and are never touched.
export const SYSTEM_TABLE = /^(sqlite_|_litestream_)/;

/** The application's tables: everything but system and transient tables. */
export function appTables(sqlite: Sqlite): string[] {
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((r) => r.name as string);
  return names.filter((n) => !SYSTEM_TABLE.test(n) && !TRANSIENT_TABLE.test(n)).sort();
}

/** Tables in the database with no purge rule (must be empty; pinned by the test). */
export function unruledTables(sqlite: Sqlite): string[] {
  return appTables(sqlite).filter((n) => !purgeRule(n));
}

// ── Target ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type PurgeTarget = { ownerUserId: number } | { organizationId: number };

export interface PurgeRefusal { status: number; code: string; error: string; detail?: any }

interface Sets { labs: number[]; orgs: number[]; staffLabs: number[]; owners: number[]; accounts: number[]; people: number[] }

const uniq = (xs: any[]) => [...new Set(xs.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);

function params(sets: Sets, now: number) {
  return {
    labs: JSON.stringify(sets.labs), orgs: JSON.stringify(sets.orgs), staffLabs: JSON.stringify(sets.staffLabs),
    accounts: JSON.stringify(sets.accounts), people: JSON.stringify(sets.people), now,
  };
}

// Only the parameters a statement names (better-sqlite3 refuses extra named parameters).
function bind(sql: string, all: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const m of sql.matchAll(/@(\w+)/g)) out[m[1]] = all[m[1]];
  return out;
}

export function targetKey(t: PurgeTarget): string {
  return "ownerUserId" in t ? `owner-${t.ownerUserId}` : `org-${t.organizationId}`;
}

export function confirmPhrase(t: PurgeTarget): string {
  return `DELETE CUSTOMER ${targetKey(t)}`;
}

// ── Plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PurgePlan {
  target: string;
  confirmPhrase: string;
  labs: Array<{ id: number; lab_name: string; clia_number: string | null; organization_id: number | null }>;
  organizationIds: number[];
  staffLabIds: number[];
  people: { delete: number; keep: number; keepReasons: Record<string, number> };
  totalRows: number;
  rowsByTable: Record<string, number>;
  detach: Record<string, number>;
  files: { count: number; folders: number };
  retainedForPeople: Record<string, { rows: number; reason: string }>;
  retainedTables: string[];
  backups: string;
}

interface Internal {
  sets: Sets;
  rowids: Record<string, number[]>;
  detach: Array<{ edge: FkEdge; rowids: number[] }>;
  parentKeys: Array<{ edge: FkEdge; values: any[] }>;
  files: string[];
  folders: string[];
}

const BACKUPS = "Backup copies made before the purge are not touched; nightly copies age out after 2 years and hourly copies after 7 days.";

function insideRoot(root: string, p: string): boolean {
  const r = path.resolve(root) + path.sep;
  return path.resolve(p).startsWith(r);
}

/** The dry run: everything the purge would delete, keep and clear. Writes nothing. */
export function planCustomerPurge(sqlite: Sqlite, target: PurgeTarget): { plan: PurgePlan; internal: Internal } | PurgeRefusal {
  const one = (sql: string, ...a: any[]) => sqlite.prepare(sql).get(...a) as any;
  const all = (sql: string, ...a: any[]) => sqlite.prepare(sql).all(...a) as any[];

  // 1. Labs and organizations.
  let labRows: any[];
  let orgs: number[];
  if ("ownerUserId" in target) {
    const owner = one("SELECT id, email FROM users WHERE id = ?", target.ownerUserId);
    if (!owner) return { status: 404, code: "NOT_FOUND", error: "No such account" };
    labRows = all("SELECT id, lab_name, clia_number, organization_id, owner_user_id, COALESCE(is_demo, 0) AS is_demo FROM labs WHERE owner_user_id = ? ORDER BY id", target.ownerUserId);
    orgs = uniq([
      ...labRows.map((l) => l.organization_id),
      ...all("SELECT id FROM organizations WHERE billing_owner_user_id = ?", target.ownerUserId).map((r) => r.id),
    ]);
  } else {
    const org = one("SELECT id FROM organizations WHERE id = ?", target.organizationId);
    if (!org) return { status: 404, code: "NOT_FOUND", error: "No such organization" };
    labRows = all("SELECT id, lab_name, clia_number, organization_id, owner_user_id, COALESCE(is_demo, 0) AS is_demo FROM labs WHERE organization_id = ? ORDER BY id", target.organizationId);
    orgs = [target.organizationId];
  }
  if (!labRows.length) return { status: 404, code: "NO_LABS", error: "The customer has no labs" };
  const labs = uniq(labRows.map((l) => l.id));
  const owners = uniq(labRows.map((l) => l.owner_user_id));
  const labSet = new Set(labs);

  if (labRows.some((l) => l.is_demo)) {
    return { status: 400, code: "PROTECTED_ACCOUNT", error: "A demo lab is never purged", detail: { demoLabIds: labRows.filter((l) => l.is_demo).map((l) => l.id) } };
  }
  for (const o of owners) {
    const u = one("SELECT email FROM users WHERE id = ?", o);
    if (isVeritasLogin(u?.email)) return { status: 400, code: "PROTECTED_ACCOUNT", error: "A Veritas account is never purged", detail: { ownerUserId: o } };
  }
  // An owner's account-level data (VeritaQA, the audit trail) belongs to all of its labs, so every one must go together.
  const ownersOutside = all(`SELECT id, owner_user_id FROM labs WHERE owner_user_id IN (${owners.map(() => "?").join(",")})`, ...owners).filter((l) => !labSet.has(l.id));
  if (ownersOutside.length) {
    return { status: 409, code: "OWNER_HAS_OTHER_LABS", error: "An owner of these labs also owns labs outside the customer; purge by the owner account instead", detail: { labIds: uniq(ownersOutside.map((l) => l.id)) } };
  }
  for (const org of orgs) {
    const outside = all("SELECT id FROM labs WHERE organization_id = ?", org).filter((l) => !labSet.has(l.id));
    if (outside.length) {
      return { status: 409, code: "ORG_HAS_OTHER_LABS", error: "An organization of this customer holds labs outside it; purge by the organization instead", detail: { organizationId: org, labIds: uniq(outside.map((l) => l.id)) } };
    }
  }
  const orgSet = new Set(orgs);
  const ownerSet = new Set(owners);
  const staffLabs = uniq(all(
    `SELECT id FROM staff_labs WHERE tier2_lab_id IN (${labs.map(() => "?").join(",")}) OR user_id IN (${owners.map(() => "?").join(",")})`,
    ...labs, ...owners,
  ).map((r) => r.id));

  // 2. People: the owners, the labs' members and seat holders, and the organizations' members. A person is kept when they
  // belong anywhere outside the customer, or log in for Veritas.
  const ph = (xs: number[]) => (xs.length ? xs.map(() => "?").join(",") : "NULL");
  const candidates = uniq([
    ...owners,
    ...all(`SELECT user_id FROM lab_members WHERE lab_id IN (${ph(labs)})`, ...labs).map((r) => r.user_id),
    ...all(`SELECT seat_user_id FROM user_seats WHERE seat_user_id IS NOT NULL AND (lab_id IN (${ph(labs)}) OR (lab_id IS NULL AND owner_user_id IN (${ph(owners)})))`, ...labs, ...owners).map((r) => r.seat_user_id),
    ...(orgs.length ? all(`SELECT user_id FROM organization_members WHERE organization_id IN (${ph(orgs)})`, ...orgs).map((r) => r.user_id) : []),
  ]);
  const keepReasons: Record<string, number> = {};
  const keep = new Map<number, string>();
  const mark = (id: number, why: string) => { if (!keep.has(id)) { keep.set(id, why); keepReasons[why] = (keepReasons[why] ?? 0) + 1; } };
  for (const id of candidates) {
    const u = one("SELECT email FROM users WHERE id = ?", id);
    if (!u) continue;
    if (isVeritasLogin(u.email)) { mark(id, "veritasLogin"); continue; }
    if (all("SELECT lab_id FROM lab_members WHERE user_id = ?", id).some((r) => !labSet.has(Number(r.lab_id)))) { mark(id, "memberElsewhere"); continue; }
    if (all("SELECT id FROM labs WHERE owner_user_id = ?", id).some((r) => !labSet.has(Number(r.id)))) { mark(id, "ownsLabElsewhere"); continue; }
    if (all("SELECT lab_id, owner_user_id FROM user_seats WHERE seat_user_id = ?", id).some((r) => (r.lab_id != null ? !labSet.has(Number(r.lab_id)) : !ownerSet.has(Number(r.owner_user_id))))) { mark(id, "seatElsewhere"); continue; }
    if (all("SELECT organization_id FROM organization_members WHERE user_id = ?", id).some((r) => !orgSet.has(Number(r.organization_id)))) { mark(id, "orgElsewhere"); continue; }
    if (all("SELECT id FROM organizations WHERE billing_owner_user_id = ?", id).some((r) => !orgSet.has(Number(r.id)))) { mark(id, "billsOrgElsewhere"); continue; }
  }

  const meta = introspect(sqlite);
  const appSet = new Set(appTables(sqlite));
  const tables = meta.tables.filter((t) => appSet.has(t)).sort();
  const unruled = tables.filter((t) => !purgeRule(t));
  if (unruled.length) return { status: 409, code: "UNCLASSIFIED_TABLES", error: "Tables with no purge rule; add them to exportAllTables.ts or customerPurge.ts first", detail: { tables: unruled } };
  const withoutRowid = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%WITHOUT ROWID%'").all() as any[]).map((r) => r.name);
  if (withoutRowid.length) return { status: 409, code: "WITHOUT_ROWID", error: "Tables without rowid aren't supported", detail: { tables: withoutRowid } };

  const now = Date.now();
  const edges = meta.edges.filter((e) => tables.includes(e.child) && tables.includes(e.parent));
  const colNotNull = (t: string, c: string) => !!(sqlite.prepare(`PRAGMA table_info("${t}")`).all() as any[]).find((x) => x.name === c)?.notnull;

  // 3. Rows, then references from rows that stay. A NOT NULL reference to a person keeps that person (their account
  // stays, nothing of the customer's does); to anything else it refuses the plan. Repeat until nothing changes.
  for (let pass = 0; pass < 5; pass++) {
    const people = candidates.filter((id) => !keep.has(id));
    const sets: Sets = { labs, orgs, staffLabs, owners, accounts: uniq([...owners, ...people]), people };
    const p = params(sets, now);
    const rowids: Record<string, number[]> = {};
    for (const t of tables) {
      const rule = purgeRule(t)!;
      if (rule.kind !== "delete") continue;
      const sql = `SELECT rowid AS r FROM "${t}" WHERE ${rule.where}`;
      const ids = (sqlite.prepare(sql).all(bind(sql, p)) as any[]).map((x) => Number(x.r));
      if (ids.length) rowids[t] = ids;
    }
    const outsideRefs: Array<{ edge: FkEdge; rowids: number[]; notnull: boolean }> = [];
    const parentKeys: Array<{ edge: FkEdge; values: any[] }> = [];
    for (const e of edges) {
      const deleted = rowids[e.parent];
      if (!deleted?.length) continue;
      const values = (sqlite.prepare(`SELECT DISTINCT "${e.to}" AS v FROM "${e.parent}" WHERE rowid IN (SELECT value FROM json_each(?)) AND "${e.to}" IS NOT NULL`).all(JSON.stringify(deleted)) as any[]).map((x) => x.v);
      if (!values.length) continue;
      parentKeys.push({ edge: e, values });
      const gone = new Set(rowids[e.child] ?? []);
      const refs = (sqlite.prepare(`SELECT rowid AS r FROM "${e.child}" WHERE "${e.from}" IN (SELECT value FROM json_each(?))`).all(JSON.stringify(values)) as any[])
        .map((x) => Number(x.r)).filter((r) => !gone.has(r));
      if (refs.length) outsideRefs.push({ edge: e, rowids: refs, notnull: colNotNull(e.child, e.from) });
    }
    const blocking = outsideRefs.filter((o) => o.notnull);
    let changed = false;
    const blockers: Record<string, number> = {};
    for (const b of blocking) {
      if (b.edge.parent === "users") {
        // Keep the people those rows point at (never an owner).
        const ids = (sqlite.prepare(`SELECT DISTINCT "${b.edge.from}" AS u FROM "${b.edge.child}" WHERE rowid IN (SELECT value FROM json_each(?))`).all(JSON.stringify(b.rowids)) as any[]).map((x) => Number(x.u));
        for (const u of ids) {
          if (ownerSet.has(u)) { blockers[`${b.edge.child}.${b.edge.from}`] = (blockers[`${b.edge.child}.${b.edge.from}`] ?? 0) + 1; continue; }
          if (!keep.has(u)) { mark(u, "referencedElsewhere"); changed = true; }
        }
      } else {
        blockers[`${b.edge.child}.${b.edge.from}`] = b.rowids.length;
      }
    }
    if (Object.keys(blockers).length) {
      return { status: 409, code: "REFERENCED_ELSEWHERE", error: "Records outside the customer point at the customer's rows through a column that can't be cleared", detail: { blockers } };
    }
    if (changed) continue;

    // 4. Stored files and folders, read before any row goes.
    const files: string[] = [];
    const folders: string[] = [];
    const sel = (t: string, cols: string) => rowids[t]?.length
      ? sqlite.prepare(`SELECT ${cols} FROM "${t}" WHERE rowid IN (SELECT value FROM json_each(?))`).all(JSON.stringify(rowids[t])) as any[]
      : [];
    for (const r of sel("policy_versions", "file_path")) if (r.file_path) files.push(resolveVersionFilePath(r.file_path));
    for (const r of sel("policy_carried_records", "face_page_path, original_path")) {
      if (r.face_page_path) files.push(resolveVersionFilePath(r.face_page_path));
      if (r.original_path) files.push(resolveVersionFilePath(r.original_path));
    }
    const legacyRoot = path.join(process.cwd(), "uploads", "policies");
    for (const r of sel("veritapolicy_lab_policies", "document_path")) if (r.document_path) files.push(path.join(legacyRoot, path.basename(String(r.document_path))));
    for (const id of labs) {
      folders.push(path.join(POLICY_STORAGE_ROOT, String(id)));
      folders.push(path.join(exportDir(), `lab-${id}`));
    }
    const safeFiles = uniqStr(files).filter((f) => insideRoot(POLICY_STORAGE_ROOT, f) || insideRoot(legacyRoot, f));

    const peopleInfo = people.length ? all(`SELECT lower(email) AS e FROM users WHERE id IN (${ph(people)})`, ...people).map((r) => r.e).filter(Boolean) : [];
    const retainedForPeople: Record<string, { rows: number; reason: string }> = {};
    const countIf = (key: string, sql: string, args: any[]) => {
      try { const n = Number(sqlite.prepare(sql).get(...args)?.n ?? 0); if (n) retainedForPeople[key] = { rows: n, reason: (PURGE_EXCLUDED[key] as any)?.reason ?? "" }; } catch { /* table absent */ }
    };
    if (people.length) {
      countIf("terms_acceptances", `SELECT COUNT(*) AS n FROM terms_acceptances WHERE user_id IN (${ph(people)})`, people);
      countIf("invoice_requests", `SELECT COUNT(*) AS n FROM invoice_requests WHERE user_id IN (${ph(people)})`, people);
    }
    if (peopleInfo.length) {
      const e = peopleInfo.map(() => "?").join(",");
      countIf("newsletter_subscribers", `SELECT COUNT(*) AS n FROM newsletter_subscribers WHERE lower(email) IN (${e})`, peopleInfo);
      countIf("contact_messages", `SELECT COUNT(*) AS n FROM contact_messages WHERE lower(email) IN (${e})`, peopleInfo);
      countIf("founding_lab_applications", `SELECT COUNT(*) AS n FROM founding_lab_applications WHERE lower(contact_email) IN (${e})`, peopleInfo);
      countIf("schedule_bookings", `SELECT COUNT(*) AS n FROM schedule_bookings WHERE lower(booker_email) IN (${e})`, peopleInfo);
    }

    const rowsByTable: Record<string, number> = {};
    for (const [t, ids] of Object.entries(rowids).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) rowsByTable[t] = ids.length;
    const detach: Record<string, number> = {};
    for (const o of outsideRefs) detach[`${o.edge.child}.${o.edge.from}`] = (detach[`${o.edge.child}.${o.edge.from}`] ?? 0) + o.rowids.length;
    const plan: PurgePlan = {
      target: targetKey(target),
      confirmPhrase: confirmPhrase(target),
      labs: labRows.map((l) => ({ id: l.id, lab_name: l.lab_name, clia_number: l.clia_number ?? null, organization_id: l.organization_id ?? null })),
      organizationIds: orgs,
      staffLabIds: staffLabs,
      people: { delete: people.length, keep: keep.size, keepReasons },
      totalRows: Object.values(rowsByTable).reduce((s, n) => s + n, 0),
      rowsByTable,
      detach,
      files: { count: safeFiles.length, folders: folders.length },
      retainedForPeople,
      retainedTables: tables.filter((t) => purgeRule(t)!.kind === "retain"),
      backups: BACKUPS,
    };
    return { plan, internal: { sets, rowids, detach: outsideRefs.map((o) => ({ edge: o.edge, rowids: o.rowids })), parentKeys, files: safeFiles, folders } };
  }
  return { status: 409, code: "PLAN_UNSTABLE", error: "The plan didn't settle; nothing was changed" };
}

function uniqStr(xs: string[]): string[] { return [...new Set(xs)]; }

// ── Apply ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PurgeResult {
  applied: true;
  target: string;
  labIds: number[];
  organizationIds: number[];
  deletedRows: number;
  rowsByTable: Record<string, number>;
  detached: Record<string, number>;
  people: PurgePlan["people"];
  files: { deleted: number; missing: number; failed: number; foldersRemoved: number };
  auditId: number;
}

/** Deletes exactly the planned rows in one transaction, then the stored files. The caller has checked the plan's count. */
export function applyCustomerPurge(sqlite: Sqlite, plan: PurgePlan, internal: Internal): PurgeResult {
  const prevSecure = sqlite.pragma("secure_delete", { simple: true });
  sqlite.pragma("secure_delete = ON");
  let deleted = 0;
  const byTable: Record<string, number> = {};
  const detached: Record<string, number> = {};
  let auditId = -1;
  try {
    const run = sqlite.transaction(() => {
      sqlite.exec("PRAGMA defer_foreign_keys = ON");
      for (const d of internal.detach) {
        const n = sqlite.prepare(`UPDATE "${d.edge.child}" SET "${d.edge.from}" = NULL WHERE rowid IN (SELECT value FROM json_each(?))`).run(JSON.stringify(d.rowids)).changes;
        detached[`${d.edge.child}.${d.edge.from}`] = (detached[`${d.edge.child}.${d.edge.from}`] ?? 0) + n;
      }
      for (const [t, ids] of Object.entries(internal.rowids)) {
        const n = sqlite.prepare(`DELETE FROM "${t}" WHERE rowid IN (SELECT value FROM json_each(?))`).run(JSON.stringify(ids)).changes;
        byTable[t] = n;
        deleted += n;
      }
      if (deleted !== plan.totalRows) throw new Error(`customer-purge: deleted ${deleted} rows, planned ${plan.totalRows}`);
      // Nothing left may point at a deleted row, whether or not this connection enforces foreign keys.
      for (const pk of internal.parentKeys) {
        const n = Number(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${pk.edge.child}" WHERE "${pk.edge.from}" IN (SELECT value FROM json_each(?))`).get(JSON.stringify(pk.values)).n);
        if (n) throw new Error(`customer-purge: ${n} rows of ${pk.edge.child}.${pk.edge.from} still point at deleted ${pk.edge.parent} rows`);
      }
      // The record of the purge: ids and counts, no names. user 0 is the system actor; owner 0 so no later purge takes it.
      auditId = Number(sqlite.prepare(`
        INSERT INTO audit_log (user_id, owner_user_id, module, action, entity_type, entity_id, entity_label, before_json, after_json, ip_address, acting_as, created_at)
        VALUES (0, 0, 'admin', 'delete', 'customer_purge', ?, NULL, NULL, ?, NULL, NULL, datetime('now'))`).run(plan.target, JSON.stringify({
        labIds: plan.labs.map((l) => l.id), organizationIds: plan.organizationIds, staffLabIds: plan.staffLabIds,
        people: plan.people, deletedRows: deleted, rowsByTable: byTable, detached, files: plan.files,
      })).lastInsertRowid);
    });
    run();
  } finally {
    sqlite.pragma(`secure_delete = ${Number(prevSecure) ? "ON" : "OFF"}`);
  }
  try { sqlite.pragma("wal_checkpoint(TRUNCATE)"); } catch { /* not in WAL mode */ }

  const files = { deleted: 0, missing: 0, failed: 0, foldersRemoved: 0 };
  for (const f of internal.files) {
    try {
      if (!fs.existsSync(f)) { files.missing++; continue; }
      fs.unlinkSync(f);
      files.deleted++;
    } catch { files.failed++; }
  }
  for (const dir of internal.folders) {
    try {
      if (!fs.existsSync(dir)) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      files.foldersRemoved++;
    } catch { files.failed++; }
  }
  return {
    applied: true, target: plan.target, labIds: plan.labs.map((l) => l.id), organizationIds: plan.organizationIds,
    deletedRows: deleted, rowsByTable: byTable, detached, people: plan.people, files, auditId,
  };
}

// ── Route ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Applying is off unless the server was started with CUSTOMER_PURGE_ENABLED=1 for the run. The dry run always works. */
export const purgeEnabled = () => process.env.CUSTOMER_PURGE_ENABLED === "1";

export function parseTarget(body: any): PurgeTarget | null {
  const o = body?.ownerUserId, g = body?.organizationId;
  const ok = (n: any) => Number.isInteger(n) && n > 0;
  if (ok(o) && g == null) return { ownerUserId: o };
  if (ok(g) && o == null) return { organizationId: g };
  return null;
}

export function registerCustomerPurgeRoutes(app: any, deps: { sqlite: () => Sqlite; adminSecret: string | undefined }) {
  const adminOnly = (req: any, res: any, next: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!deps.adminSecret || !secret || secret !== deps.adminSecret) return res.status(403).json({ error: "Forbidden" });
    next();
  };
  // POST /api/admin/customer-purge  { ownerUserId | organizationId, dryRun?, expectedTotal?, confirm? }
  // A dry run unless dryRun is false; applying also needs expectedTotal (the dry run's totalRows), the dry run's
  // confirmPhrase, and CUSTOMER_PURGE_ENABLED=1 on the server.
  app.post("/api/admin/customer-purge", adminOnly, (req: any, res: any) => {
    res.setHeader("Cache-Control", "no-store");
    const target = parseTarget(req.body);
    if (!target) return res.status(400).json({ code: "BAD_TARGET", error: "Give exactly one of ownerUserId or organizationId (a positive integer)" });
    const sqlite = deps.sqlite();
    const out = planCustomerPurge(sqlite, target);
    if ("status" in out) return res.status(out.status).json(out);
    const { plan, internal } = out;
    if (req.body?.dryRun !== false) return res.json({ dryRun: true, applyEnabled: purgeEnabled(), ...plan });
    if (!purgeEnabled()) return res.status(403).json({ code: "PURGE_DISABLED", error: "Applying is turned off on this server. Start it with CUSTOMER_PURGE_ENABLED=1 for the run, then remove it.", plan });
    if (req.body?.confirm !== plan.confirmPhrase) return res.status(400).json({ code: "CONFIRM_REQUIRED", error: `Send confirm: "${plan.confirmPhrase}"`, plan });
    if (req.body?.expectedTotal !== plan.totalRows) return res.status(409).json({ code: "COUNT_CHANGED", error: "The row count isn't the dry run's; run the dry run again", plan });
    try {
      const result = applyCustomerPurge(sqlite, plan, internal);
      console.log(`[ADMIN] customer-purge ${plan.target} labs=${result.labIds.join(",")} rows=${result.deletedRows} people=${plan.people.delete} audit=${result.auditId} at=${new Date().toISOString()}`);
      res.json(result);
    } catch (err: any) {
      console.error(`[ADMIN] customer-purge ${plan.target} rolled back:`, err?.message);
      res.status(500).json({ code: "ROLLED_BACK", error: "The purge failed and nothing was deleted", detail: String(err?.message || err) });
    }
  });
}
