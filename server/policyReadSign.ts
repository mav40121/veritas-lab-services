// server/policyReadSign.ts
//
// VeritaDC read-and-sign by group (Step D of Heywood's move out of MediaLab). An editor assigns a document, a whole manual or
// sub-manual, or every document in the lab, to lab groups, named roster people, or everyone in the lab. Before this, every Staff
// login saw every approved document as theirs to sign, so a lab with 742 documents couldn't invite its staff.
//
// An assignment is a rule, not a row per person per document. Who owes what is worked out when it is read:
//   - a document added to an assigned manual, or moved into one, is covered at once;
//   - a person added to a group owes what the group owes, and someone who leaves the active roster stops owing;
//   - a manual's assignment covers its sub-manuals at any depth.
// Signatures stay where they always were (staff_portal_policy_signatures, policy_attestations), and a new version asks again by the
// existing rule (server/policyMinorRevision.ts). Groups are lab_groups (server/labGroups.ts); there is no second group table.
//
// Assigning sends no email, at any scope. The only mail here is the notice an editor sends on purpose (noticePlan, sendNotice).
//
// A Staff login reaches documents through veritaDcStaffGuard, one guard in front of every /api/labs/:labId/veritapolicy route, so a
// route added later is covered too. Who is limited is staffOwnScope (Q182, Q186): a Staff seat with edit on VeritaDC, the owner, an
// admin, an org admin and anyone holding another live seat are not. A limited login:
//   - sees only what's assigned to them in the document list, My sign-offs and the bell, and can only sign those;
//   - can look up and read any approved document's approved version, read-only: the current version, or while a newer revision
//     is a draft or in review the version recorded as approved (BUG-151, server/policyApprovedVersion.ts). 42 CFR 493.1251(a)
//     says the procedure manual must be available to laboratory personnel, and a tech covering another bench needs the procedure
//     there. It is a search, not a list, and it never asks for a signature;
//   - never reads who else has signed or owes: the tracker, signature list, signature report, audit trail and compliance page refuse.

import { orderManualTree } from "@shared/manualTree";
import { checkAuthToken } from "./sessionAuth";
import { staffOwnScope } from "./competencySelfEntry";
import { employeeLoginAddress } from "./labGroups";
import { labCarriesMinorRevisions } from "./policyMinorRevision";
import { writeAuditLog } from "./veritapolicyApproval";
import { approvedReadVersionId, approvedReadVersionSql, revisionInProgress, revisionInProgressSql } from "./policyApprovedVersion";

export type ReadSignScopeType = "document" | "manual" | "lab";
export type ReadSignTargetType = "group" | "person" | "everyone";
export interface ReadSignScope { type: ReadSignScopeType; id: number | null }

export interface ReadSignRule {
  id: number;
  lab_id: number;
  scope_type: ReadSignScopeType;
  document_id: number | null;
  manual_id: number | null;
  target_type: ReadSignTargetType;
  group_id: number | null;
  employee_id: number | null;
  assigned_by: number | null;
  assigned_at: string;
  origin: string | null;
}

export interface ReadSignContext {
  labId: number;
  rules: ReadSignRule[];
  roster: any[];
  rosterIds: Set<number>;
  groupNames: Map<number, string>;
  groupPeople: Map<number, Set<number>>;
  parentOf: Map<number, number | null>;
  manuals: any[];
}

/** The lab's VeritaStaff roster id: the same lookup the rest of the Staff routes use (staffLabByLabId in server/routes.ts). */
export function staffLabIdFor(sqlite: any, labId: number): number | null {
  const byTier = sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(labId) as any;
  if (byTier) return byTier.id;
  const owner = sqlite.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(labId) as any;
  if (!owner) return null;
  const rows = sqlite.prepare("SELECT id FROM staff_labs WHERE user_id = ?").all(owner.owner_user_id) as any[];
  return rows.length === 1 ? rows[0].id : null;
}

// A typed address in a group counts as the roster person behind it, when there is one: their staff login seat, or their own login.
function employeeForAddress(sqlite: any, labId: number, email: string): number | null {
  const seat = sqlite.prepare(
    `SELECT us.staff_employee_id AS id FROM user_seats us LEFT JOIN users u ON u.id = us.seat_user_id
      WHERE us.lab_id = ? AND us.seat_type = 'staff_portal' AND us.status IN ('active','pending') AND us.staff_employee_id IS NOT NULL
        AND (lower(us.seat_email) = lower(?) OR lower(u.email) = lower(?))
      ORDER BY us.id DESC LIMIT 1`
  ).get(labId, email, email) as any;
  if (seat) return seat.id;
  const own = sqlite.prepare(
    `SELECT se.id FROM staff_employees se JOIN users u ON u.id = se.login_user_id
      WHERE se.tier2_lab_id = ? AND se.status = 'active' AND lower(u.email) = lower(?) LIMIT 1`
  ).get(labId, email) as any;
  return own?.id ?? null;
}

export function loadReadSignContext(sqlite: any, labId: number): ReadSignContext {
  const rules = sqlite.prepare("SELECT * FROM policy_read_sign_assignments WHERE lab_id = ? AND removed_at IS NULL ORDER BY id").all(labId) as ReadSignRule[];
  const staffLab = staffLabIdFor(sqlite, labId);
  const roster = staffLab == null ? [] : sqlite.prepare(
    "SELECT id, first_name, last_name, middle_initial, title, login_user_id FROM staff_employees WHERE lab_id = ? AND status = 'active'"
  ).all(staffLab) as any[];
  const rosterIds = new Set<number>(roster.map((e) => e.id));
  const groupNames = new Map<number, string>();
  const groupPeople = new Map<number, Set<number>>();
  for (const g of sqlite.prepare("SELECT id, name FROM lab_groups WHERE lab_id = ? AND retired = 0").all(labId) as any[]) {
    groupNames.set(g.id, g.name);
    groupPeople.set(g.id, new Set());
  }
  const typed = new Map<string, number | null>();
  for (const m of sqlite.prepare("SELECT group_id, employee_id, email FROM lab_group_members WHERE lab_id = ?").all(labId) as any[]) {
    const people = groupPeople.get(m.group_id);
    if (!people) continue; // a retired group
    let emp: number | null = m.employee_id ?? null;
    if (emp == null && m.email) {
      const key = String(m.email).toLowerCase();
      if (!typed.has(key)) typed.set(key, employeeForAddress(sqlite, labId, m.email));
      emp = typed.get(key) ?? null;
    }
    if (emp != null && rosterIds.has(emp)) people.add(emp);
  }
  const manuals = sqlite.prepare("SELECT id, parent_id, name, display_order, archived_at FROM policy_manuals WHERE lab_id = ?").all(labId) as any[];
  const parentOf = new Map<number, number | null>(manuals.map((m) => [m.id, m.parent_id ?? null]));
  return { labId, rules, roster, rosterIds, groupNames, groupPeople, parentOf, manuals };
}

/** A manual and every manual it sits inside. A stored loop stops instead of running forever. */
export function manualChain(ctx: ReadSignContext, manualId: number | null | undefined): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  let at = manualId ?? null;
  while (at != null && !seen.has(at)) {
    seen.add(at);
    out.push(at);
    at = ctx.parentOf.get(at) ?? null;
  }
  return out;
}

function ruleCovers(ctx: ReadSignContext, r: ReadSignRule, doc: { id: number; manual_id?: number | null }): boolean {
  if (r.scope_type === "lab") return true;
  if (r.scope_type === "document") return r.document_id === doc.id;
  return r.manual_id != null && manualChain(ctx, doc.manual_id).includes(r.manual_id);
}

export function rulesForDocument(ctx: ReadSignContext, doc: { id: number; manual_id?: number | null }): ReadSignRule[] {
  return ctx.rules.filter((r) => ruleCovers(ctx, r, doc));
}

export function peopleOfRule(ctx: ReadSignContext, r: ReadSignRule): Set<number> {
  if (r.target_type === "everyone") return ctx.rosterIds;
  if (r.target_type === "person") return r.employee_id != null && ctx.rosterIds.has(r.employee_id) ? new Set([r.employee_id]) : new Set();
  return (r.group_id != null && ctx.groupPeople.get(r.group_id)) || new Set();
}

const ruleReaches = (ctx: ReadSignContext, r: ReadSignRule, employeeId: number): boolean => peopleOfRule(ctx, r).has(employeeId);

/**
 * Every document this person has been assigned: by a rule, or by an older per-person assignment (policy_attestations) that is still
 * open or sits on the current version. Status isn't checked here; the callers ask for approved documents.
 */
export function assignedDocumentIds(sqlite: any, labId: number, who: { employeeId: number | null; userId: number }, given?: ReadSignContext): Set<number> {
  const out = new Set<number>();
  for (const a of sqlite.prepare(
    `SELECT a.document_id FROM policy_attestations a JOIN policy_documents d ON d.id = a.document_id
      WHERE d.lab_id = ? AND a.assigned_to_user_id = ? AND (a.completed_at IS NULL OR a.version_id = d.current_version_id)`
  ).all(labId, who.userId) as any[]) out.add(a.document_id);
  if (who.employeeId == null) return out;
  const ctx = given ?? loadReadSignContext(sqlite, labId);
  const mine = ctx.rules.filter((r) => ruleReaches(ctx, r, who.employeeId as number));
  if (!mine.length) return out;
  for (const d of sqlite.prepare("SELECT id, manual_id FROM policy_documents WHERE lab_id = ? AND archived_at IS NULL").all(labId) as any[]) {
    if (mine.some((r) => ruleCovers(ctx, r, d))) out.add(d.id);
  }
  return out;
}

/** "Chemistry, Blood Bank" for the editor's document list: who a document goes to, or null when nobody is assigned it. */
export function targetLabels(ctx: ReadSignContext, rules: ReadSignRule[]): string[] {
  const named = rules.filter((r) => r.target_type === "person").length;
  const labels = new Set<string>();
  if (rules.some((r) => r.target_type === "everyone")) labels.add("Everyone in the lab");
  for (const r of rules) if (r.target_type === "group" && r.group_id != null) labels.add(ctx.groupNames.get(r.group_id) ?? "A retired group");
  if (named) labels.add(`${named} named ${named === 1 ? "person" : "people"}`);
  return [...labels];
}

// A person's name as the signature list shows it.
const rosterName = (e: any) => [e.last_name, e.first_name].filter(Boolean).join(", ") + (e.middle_initial ? ` ${e.middle_initial}.` : "");

// ── Who has signed, for many people and documents at once ────────────────────
// The same rule as documentSignatureStatus (server/policySignatureStatus.ts): a Staff login signature or a completed attestation counts
// on the version signed, or on an earlier minor revision in a lab that carries those forward. Read in bulk because a 742-document
// lab can't ask once per pair. tests/integration/veritadc-read-sign-groups.test.ts checks the two agree.
export function signedLookup(sqlite: any, ctx: ReadSignContext): (doc: { id: number; current_version_id: number | null }, employeeId: number) => boolean {
  const labId = ctx.labId;
  const carries = labCarriesMinorRevisions(sqlite, labId);
  const majorOf = new Map<number, number>();
  if (carries) {
    for (const v of sqlite.prepare(
      `SELECT v.id, COALESCE(v.version_major, v.version_number) AS m FROM policy_versions v JOIN policy_documents d ON d.id = v.document_id WHERE d.lab_id = ?`
    ).all(labId) as any[]) majorOf.set(v.id, v.m);
  }
  const versions = new Map<string, number[]>();
  const add = (documentId: number, employeeId: number, versionId: number) => {
    const key = `${documentId}:${employeeId}`;
    const list = versions.get(key);
    if (list) list.push(versionId); else versions.set(key, [versionId]);
  };
  for (const s of sqlite.prepare("SELECT document_id, version_id, staff_employee_id FROM staff_portal_policy_signatures WHERE lab_id = ?").all(labId) as any[]) {
    add(s.document_id, s.staff_employee_id, s.version_id);
  }
  // A signature carried over from the prior system counts for the version it was loaded against (server/policyPriorSignature.ts).
  for (const p of sqlite.prepare("SELECT document_id, version_id, staff_employee_id FROM policy_prior_signatures WHERE lab_id = ? AND staff_employee_id IS NOT NULL AND version_id IS NOT NULL").all(labId) as any[]) {
    add(p.document_id, p.staff_employee_id, p.version_id);
  }
  const employeeOfUser = new Map<number, number>();
  for (const e of ctx.roster) if (e.login_user_id) employeeOfUser.set(e.login_user_id, e.id);
  for (const s of sqlite.prepare(
    "SELECT staff_employee_id, seat_user_id FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL AND seat_user_id IS NOT NULL"
  ).all(labId) as any[]) employeeOfUser.set(s.seat_user_id, s.staff_employee_id);
  for (const a of sqlite.prepare(
    `SELECT a.document_id, a.version_id, a.assigned_to_user_id FROM policy_attestations a JOIN policy_documents d ON d.id = a.document_id
      WHERE d.lab_id = ? AND a.completed_at IS NOT NULL`
  ).all(labId) as any[]) {
    const emp = employeeOfUser.get(a.assigned_to_user_id);
    if (emp != null) add(a.document_id, emp, a.version_id);
  }
  return (doc, employeeId) => {
    const list = versions.get(`${doc.id}:${employeeId}`);
    if (!list || doc.current_version_id == null) return false;
    if (list.includes(doc.current_version_id)) return true;
    if (!carries) return false;
    const major = majorOf.get(doc.current_version_id);
    return major != null && list.some((v) => majorOf.get(v) === major);
  };
}

// The approved documents in a scope that go to staff for read-and-sign (a type the lab set to no read-and-sign isn't counted).
function signableDocuments(sqlite: any, ctx: ReadSignContext, scope: ReadSignScope): any[] {
  const docs = sqlite.prepare(
    `SELECT d.id, d.title, d.manual_id, d.current_version_id FROM policy_documents d
      WHERE d.lab_id = ? AND d.status = 'approved' AND d.archived_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM policy_doc_type_settings ts WHERE ts.lab_id = d.lab_id AND ts.doc_type = d.doc_type AND ts.requires_read_and_sign = 0)`
  ).all(ctx.labId) as any[];
  if (scope.type === "document") return docs.filter((d) => d.id === scope.id);
  if (scope.type === "manual") return docs.filter((d) => manualChain(ctx, d.manual_id).includes(scope.id as number));
  return docs;
}

export interface TrackerPerson { employee_id: number; name: string; title: string | null; has_login: boolean; group_ids: number[]; groups: string[]; documents: number; signed: number; owes: number }
export interface TrackerBucket { key: string; kind: ReadSignTargetType; group_id: number | null; name: string; people: number; documents: number; signed: number; owes: number; employee_ids: number[] }

/** Who owes and who has signed in a scope, by group and by person, for owners and editors. */
export function readSignTracker(sqlite: any, labId: number, scope: ReadSignScope, given?: ReadSignContext) {
  const ctx = given ?? loadReadSignContext(sqlite, labId);
  const docs = signableDocuments(sqlite, ctx, scope);
  const isSigned = signedLookup(sqlite, ctx);
  const seats = sqlite.prepare(
    "SELECT staff_employee_id, seat_user_id FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL AND seat_user_id IS NOT NULL"
  ).all(labId) as any[];
  const seated = new Map<number, number>(seats.map((s) => [s.seat_user_id, s.staff_employee_id]));
  const hasSeat = new Set<number>(seats.map((s) => s.staff_employee_id));
  const peopleOut = new Map<number, TrackerPerson>();
  for (const e of ctx.roster) {
    const group_ids = [...ctx.groupPeople.entries()].filter(([, set]) => set.has(e.id)).map(([id]) => id);
    peopleOut.set(e.id, {
      employee_id: e.id, name: rosterName(e), title: e.title ?? null, has_login: !!e.login_user_id || hasSeat.has(e.id),
      group_ids, groups: group_ids.map((g) => ctx.groupNames.get(g) as string).sort((a, b) => a.localeCompare(b)),
      documents: 0, signed: 0, owes: 0,
    });
  }
  const buckets = new Map<string, { kind: ReadSignTargetType; group_id: number | null; name: string; people: Set<number>; docs: Set<number>; pairs: Set<string>; signed: number; owes: number }>();
  const bucketFor = (r: ReadSignRule) => {
    const key = r.target_type === "group" ? `group:${r.group_id}` : r.target_type;
    let b = buckets.get(key);
    if (!b) {
      const name = r.target_type === "everyone" ? "Everyone in the lab" : r.target_type === "person" ? "Named people" : ctx.groupNames.get(r.group_id as number) ?? "A retired group";
      b = { kind: r.target_type, group_id: r.group_id ?? null, name, people: new Set(), docs: new Set(), pairs: new Set(), signed: 0, owes: 0 };
      buckets.set(key, b);
    }
    return b;
  };
  // An older per-person assignment counts for the person's own row: while it is open, or when it sits on the current version.
  const extra = new Map<number, Set<number>>();
  for (const a of sqlite.prepare(
    `SELECT a.document_id, a.assigned_to_user_id FROM policy_attestations a JOIN policy_documents d ON d.id = a.document_id
      WHERE d.lab_id = ? AND (a.completed_at IS NULL OR a.version_id = d.current_version_id)`
  ).all(labId) as any[]) {
    const login = ctx.roster.find((e) => e.login_user_id === a.assigned_to_user_id);
    const emp = login?.id ?? seated.get(a.assigned_to_user_id);
    if (emp == null) continue;
    if (!extra.has(a.document_id)) extra.set(a.document_id, new Set());
    extra.get(a.document_id)!.add(emp);
  }
  let unassigned = 0;
  for (const d of docs) {
    const rules = rulesForDocument(ctx, d);
    const audience = new Set<number>(extra.get(d.id) || []);
    for (const r of rules) {
      const b = bucketFor(r);
      b.docs.add(d.id);
      for (const p of peopleOfRule(ctx, r)) {
        audience.add(p);
        b.people.add(p);
        // A group assigned on a manual and again on one of its documents still owes that document once.
        const pair = `${d.id}:${p}`;
        if (b.pairs.has(pair)) continue;
        b.pairs.add(pair);
        if (isSigned(d, p)) b.signed += 1; else b.owes += 1;
      }
    }
    if (!rules.length && !audience.size) unassigned += 1;
    for (const p of audience) {
      const row = peopleOut.get(p);
      if (!row) continue;
      row.documents += 1;
      if (isSigned(d, p)) row.signed += 1; else row.owes += 1;
    }
  }
  const groups: TrackerBucket[] = [...buckets.entries()].map(([key, b]) => ({
    key, kind: b.kind, group_id: b.group_id, name: b.name, people: b.people.size, documents: b.docs.size, signed: b.signed, owes: b.owes, employee_ids: [...b.people],
  })).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "everyone" ? -1 : b.kind === "everyone" ? 1 : a.kind === "group" ? -1 : 1));
  const people = [...peopleOut.values()].sort((a, b) => b.owes - a.owes || a.name.localeCompare(b.name));
  const reached = people.filter((p) => p.documents > 0);
  return {
    documents: docs.length,
    unassigned_documents: unassigned,
    groups,
    people: reached,
    totals: { people: reached.length, signed: reached.reduce((n, p) => n + p.signed, 0), owes: reached.reduce((n, p) => n + p.owes, 0), no_login: reached.filter((p) => !p.has_login).length },
  };
}

/** One document's assignment, for its signature list: who it goes to and how each group stands. */
export function documentAudience(sqlite: any, labId: number, doc: { id: number; manual_id?: number | null; current_version_id: number | null }, isSignedPerson: (employeeId: number) => boolean) {
  const ctx = loadReadSignContext(sqlite, labId);
  const rules = rulesForDocument(ctx, doc);
  const assigned = new Set<number>();
  for (const r of rules) for (const p of peopleOfRule(ctx, r)) assigned.add(p);
  const groupById = new Map<number, string[]>();
  const coveredGroups = new Set<number>(rules.filter((r) => r.target_type === "group" && r.group_id != null).map((r) => r.group_id as number));
  const groups: Array<{ id: number; name: string; total: number; signed: number; assigned: boolean }> = [];
  for (const [id, people] of ctx.groupPeople) {
    if (!people.size && !coveredGroups.has(id)) continue;
    const name = ctx.groupNames.get(id) as string;
    let signed = 0;
    for (const p of people) {
      if (isSignedPerson(p)) signed += 1;
      if (!groupById.has(p)) groupById.set(p, []);
      groupById.get(p)!.push(name);
    }
    groups.push({ id, name, total: people.size, signed, assigned: coveredGroups.has(id) });
  }
  groups.sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name));
  return {
    assigned,
    groups,
    groupsOf: (employeeId: number) => (groupById.get(employeeId) || []).slice().sort((a, b) => a.localeCompare(b)),
    groupIdsOf: (employeeId: number) => [...ctx.groupPeople.entries()].filter(([, set]) => set.has(employeeId)).map(([id]) => id),
    labels: targetLabels(ctx, rules),
  };
}

// ── What the screens read ────────────────────────────────────────────────────

const manualPaths = (ctx: ReadSignContext) => new Map<number, string>(orderManualTree(ctx.manuals).map((m: any) => [m.id, m.path]));

function ruleView(sqlite: any, ctx: ReadSignContext, r: ReadSignRule, paths: Map<number, string>, direct: boolean) {
  const person = r.target_type === "person" ? ctx.roster.find((e) => e.id === r.employee_id) : null;
  const label = r.target_type === "everyone" ? "Everyone in the lab"
    : r.target_type === "group" ? ctx.groupNames.get(r.group_id as number) ?? "A retired group"
    : person ? rosterName(person) : "Someone no longer on the roster";
  const scope_label = r.scope_type === "lab" ? "All documents"
    : r.scope_type === "manual" ? paths.get(r.manual_id as number) ?? "A manual"
    : (sqlite.prepare("SELECT title FROM policy_documents WHERE id = ?").get(r.document_id) as any)?.title ?? "A document";
  const by = r.assigned_by ? (sqlite.prepare("SELECT name, email FROM users WHERE id = ?").get(r.assigned_by) as any) : null;
  return {
    id: r.id, target_type: r.target_type, group_id: r.group_id, employee_id: r.employee_id, label,
    people: peopleOfRule(ctx, r).size, scope_type: r.scope_type, scope_label, direct, origin: r.origin ?? "editor",
    assigned_at: r.assigned_at, assigned_by: by?.name || by?.email || null,
  };
}

function scopeRules(ctx: ReadSignContext, scope: ReadSignScope, doc: any) {
  if (scope.type === "lab") return { direct: ctx.rules.filter((r) => r.scope_type === "lab"), inherited: [] as ReadSignRule[], elsewhere: ctx.rules.filter((r) => r.scope_type !== "lab") };
  if (scope.type === "manual") {
    const chain = manualChain(ctx, scope.id);
    return {
      direct: ctx.rules.filter((r) => r.scope_type === "manual" && r.manual_id === scope.id),
      inherited: ctx.rules.filter((r) => r.scope_type === "lab" || (r.scope_type === "manual" && r.manual_id !== scope.id && chain.includes(r.manual_id as number))),
      elsewhere: [] as ReadSignRule[],
    };
  }
  const all = rulesForDocument(ctx, doc);
  return { direct: all.filter((r) => r.scope_type === "document"), inherited: all.filter((r) => r.scope_type !== "document"), elsewhere: [] as ReadSignRule[] };
}

export function readSignPayload(sqlite: any, labId: number, scope: ReadSignScope, scopeName: string, canEdit: boolean) {
  const ctx = loadReadSignContext(sqlite, labId);
  const doc = scope.type === "document" ? sqlite.prepare("SELECT id, manual_id FROM policy_documents WHERE id = ?").get(scope.id) : null;
  const { direct, inherited, elsewhere } = scopeRules(ctx, scope, doc);
  const paths = manualPaths(ctx);
  const tracker = readSignTracker(sqlite, labId, scope, ctx);
  const withLogin = new Set<number>((sqlite.prepare(
    "SELECT staff_employee_id AS id FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status = 'active' AND staff_employee_id IS NOT NULL AND seat_user_id IS NOT NULL"
  ).all(labId) as any[]).map((s) => s.id));
  return {
    scope: { type: scope.type, id: scope.id, name: scopeName },
    can_edit: canEdit,
    rows: [...direct.map((r) => ruleView(sqlite, ctx, r, paths, true)), ...inherited.map((r) => ruleView(sqlite, ctx, r, paths, false))],
    elsewhere: elsewhere.map((r) => ruleView(sqlite, ctx, r, paths, true)),
    documents: tracker.documents,
    unassigned_documents: tracker.unassigned_documents,
    groups: [...ctx.groupNames.entries()].map(([id, name]) => ({ id, name, people: ctx.groupPeople.get(id)?.size ?? 0 })).sort((a, b) => a.name.localeCompare(b.name)),
    // The pickers, for whoever can assign.
    roster: !canEdit ? [] : ctx.roster
      .map((e) => ({ id: e.id, name: rosterName(e), title: e.title ?? null, has_login: !!e.login_user_id || withLogin.has(e.id) }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// ── The notice: deliberate, separate, and it says what it does ───────────────
// One email per person who owes something in this scope and can sign in, saying how many documents are waiting. Never sent by
// assigning. The editor sees the count before sending and the send names that count, so a list that changed in between doesn't mail
// people they didn't see. The same scope can't be sent twice inside a day.

export const NOTICE_COOLDOWN_HOURS = 24;
export const scopeKey = (scope: ReadSignScope) => `${scope.type}:${scope.id ?? "all"}`;

export function noticePlan(sqlite: any, labId: number, scope: ReadSignScope) {
  const ctx = loadReadSignContext(sqlite, labId);
  const tracker = readSignTracker(sqlite, labId, scope, ctx);
  const owing = tracker.people.filter((p) => p.owes > 0);
  const recipients: Array<{ employee_id: number; email: string; owes: number }> = [];
  let noAddress = 0;
  for (const p of owing) {
    const emp = ctx.roster.find((e) => e.id === p.employee_id);
    const email = p.has_login && emp ? employeeLoginAddress(sqlite, emp) : null;
    if (email) recipients.push({ employee_id: p.employee_id, email, owes: p.owes });
    else noAddress += 1;
  }
  const last = sqlite.prepare(
    `SELECT created_at FROM policy_audit_log WHERE lab_id = ? AND action = 'read_sign_notice_sent' AND json_extract(details, '$.scope') = ?
       AND created_at > datetime('now', ?) ORDER BY id DESC LIMIT 1`
  ).get(labId, scopeKey(scope), `-${NOTICE_COOLDOWN_HOURS} hours`) as any;
  return { recipients, no_login_or_address: noAddress, sent_recently_at: last?.created_at ?? null };
}

// Swapped out by the integration test, which reads what would go out. Resend's default limit is about two calls a second.
// The compliance digest's notice (server/digestIssues.ts) sends through it too, naming its own `from` on the same address.
export const readSignMailer = {
  pauseMs: 600,
  send: async (message: { to: string; subject: string; html: string; from?: string }): Promise<void> => {
    if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY is not set");
    const { Resend } = await import("resend");
    const out: any = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: "VeritaDC <info@veritaslabservices.com>", ...message });
    if (out?.error) throw new Error(out.error.message || "Resend refused the message");
  },
};

const noticeEmail = (labName: string, owes: number, link: string) => ({
  subject: `${labName}: ${owes} ${owes === 1 ? "document" : "documents"} to read and sign`,
  html: `<div>${labName} has ${owes} ${owes === 1 ? "document" : "documents"} waiting for you to read and sign in VeritaDC&trade;.</div><div><br></div>`
    + `<div><a href="${link}">Sign in and open My sign-offs</a></div><div><br></div>`
    + `<div>Your lab sent this notice once. Assigning documents doesn't send email, so you won't get another unless your lab sends one.</div>`,
});

async function sendNotice(sqlite: any, labId: number, userId: number, scope: ReadSignScope, recipients: Array<{ email: string; owes: number }>) {
  const lab = sqlite.prepare("SELECT lab_name FROM labs WHERE id = ?").get(labId) as any;
  const base = process.env.FRONTEND_URL || "https://www.veritaslabservices.com";
  const link = `${base}/labs/${labId}/my-signoffs`;
  let sent = 0, failed = 0;
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    if (i > 0 && readSignMailer.pauseMs) await new Promise((done) => setTimeout(done, readSignMailer.pauseMs));
    try {
      await readSignMailer.send({ to: r.email, ...noticeEmail(lab?.lab_name || "Your lab", r.owes, link) });
      sent += 1;
    } catch (err: any) {
      failed += 1;
      console.error("[read-sign notice] send failed:", err?.message || err);
    }
  }
  writeAuditLog(sqlite, { labId, userId, action: "read_sign_notice_finished", details: { scope: scopeKey(scope), sent, failed } });
  return { sent, failed };
}

// ── What a Staff login's own screens read ────────────────────────────────────

/** Approved documents matching a typed search, for the read-only lookup. A search, not a list: it needs two characters and stops at 50. */
export function lookupDocuments(sqlite: any, labId: number, q: string): any[] {
  const term = String(q ?? "").trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
  // current_version_id here is the version this reader reads: while a revision is a draft or in review, the approved one
  // (BUG-151). Such a row reads as approved, with revision_in_progress = 1 so the screen can say so.
  const rows = sqlite.prepare(
    `SELECT d.id AS document_id, d.title, d.description, d.doc_number, d.doc_type,
            CASE WHEN ${revisionInProgressSql("d")} = 1 THEN 'approved' ELSE d.status END AS status,
            d.manual_id, d.effective_date, d.next_review_date, ${approvedReadVersionSql("d")} AS current_version_id,
            ${revisionInProgressSql("d")} AS revision_in_progress,
            v.version_number, v.version_major, v.version_minor, m.name AS manual_name
       FROM policy_documents d
       LEFT JOIN policy_versions v ON v.id = ${approvedReadVersionSql("d")} AND v.document_id = d.id
       LEFT JOIN policy_manuals m ON m.id = d.manual_id
      WHERE d.lab_id = ? AND d.archived_at IS NULL AND ${approvedReadVersionSql("d")} IS NOT NULL
        AND (d.title LIKE ? ESCAPE '\\' OR COALESCE(d.doc_number, '') LIKE ? ESCAPE '\\' OR COALESCE(d.description, '') LIKE ? ESCAPE '\\')
      ORDER BY d.title COLLATE NOCASE
      LIMIT 50`
  ).all(labId, like, like, like) as any[];
  return rows.map((r) => ({ ...r, revision_in_progress: r.revision_in_progress === 1 }));
}

/** A read by a Staff login shows on the document's trail, as a read in the main app does. */
export function logStaffDocumentView(sqlite: any, labId: number, documentId: number, userId: number, req: any) {
  writeAuditLog(sqlite, { labId, documentId, userId, action: "viewed", details: { via: "staff_login" }, ipAddress: req.ip, userAgent: req.headers?.["user-agent"] });
}

// ── The guard in front of every VeritaDC route ───────────────────────────────

// What a limited Staff login may read on a document it can open. Anything else under /documents/:id answers 403, so a route added
// later is closed until someone decides otherwise.
const DOCUMENT_READS_ALLOWED = new Set(["", "/render", "/download", "/notes", "/links", "/quiz", "/quiz-config", "/carried/face-page", "/carried/original"]);
// Lab-wide reads that name other people, and the assigning screens.
const NEVER_FOR_STAFF = [/^\/compliance(\/|$)/, /^\/manuals\/[^/]+\/approvers(\/|$)/, /^\/delegations(\/|$)/, /^\/read-sign(\/|$)/, /^\/surveyor-links(\/|$)/];
const STAFF_OWN_REFUSAL = { error: "A staff login sees only its own sign-off status.", code: "STAFF_OWN_ONLY" };

export function veritaDcStaffGuard(sqlite: any) {
  return (req: any, res: any, next: any) => {
    const auth = req.headers?.authorization;
    if (!auth?.startsWith("Bearer ")) return next(); // the route's own check answers
    const check: any = checkAuthToken(sqlite, auth.slice(7));
    if (!check.ok || check.isDemo) return next();
    const labId = Number(req.params?.labId);
    const scope = staffOwnScope(sqlite, check.userId, labId, "veritapolicy");
    if (!scope) return next();
    req.dcStaff = { employeeId: scope.employeeId, userId: check.userId };
    const path = String(req.path || "").toLowerCase().replace(/\/+$/, "");
    if (NEVER_FOR_STAFF.some((re) => re.test(path))) return res.status(403).json(STAFF_OWN_REFUSAL);
    const m = path.match(/^\/documents\/([^/]+)(\/.*)?$/);
    if (!m) return next();
    if (req.method !== "GET" && req.method !== "HEAD") return next(); // each write has its own check, and answers 403 for a Staff login
    const id = /^\d+$/.test(m[1]) ? Number(m[1]) : NaN;
    const doc = Number.isFinite(id)
      ? (sqlite.prepare("SELECT id, status, archived_at, current_version_id, approved_version_id FROM policy_documents WHERE id = ? AND lab_id = ?").get(id, labId) as any)
      : null;
    // The approved version: the current one while approved or review-overdue, the recorded one while a revision is a draft
    // or in review (BUG-151, server/policyApprovedVersion.ts). The document routes read req.dcStaffRead to serve it.
    const versionId = approvedReadVersionId(doc);
    if (!doc || versionId == null) return res.status(404).json({ error: "Not found" });
    req.dcStaffRead = { versionId, revisionInProgress: revisionInProgress(doc) };
    const sub = m[2] || "";
    if (DOCUMENT_READS_ALLOWED.has(sub)) return next();
    const ver = sub.match(/^\/versions\/(\d+)\/render$/);
    if (ver && Number(ver[1]) === versionId) return next(); // the approved version only
    return res.status(403).json(STAFF_OWN_REFUSAL);
  };
}

// ── Routes ───────────────────────────────────────────────────────────────────

export function registerReadSignRoutes(app: any, deps: {
  sqlite: () => any;
  authMiddleware: any;
  labScopeMiddleware: any;
  requireWriteAccess: any;
  requireModuleEdit: (module: string) => any;
  hasModuleEditAccess: (labId: number, userId: number, module: string) => boolean;
}) {
  const { sqlite, authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit, hasModuleEditAccess } = deps;
  const R = "/api/labs/:labId/veritapolicy/read-sign";
  const edit = [authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit("veritapolicy")];
  const read = [authMiddleware, labScopeMiddleware];

  // Which document or manual a request means. A manual or document from another lab is not found.
  const resolveScope = (labId: number, type: unknown, idRaw: unknown): { scope: ReadSignScope; name: string } | { status: number; error: string } => {
    if (type === "lab") return { scope: { type: "lab", id: null }, name: "All documents in this lab" };
    const id = Number(idRaw);
    if (!Number.isInteger(id) || id <= 0) return { status: 400, error: "Pick a document or a manual." };
    if (type === "manual") {
      const m = sqlite().prepare("SELECT id, name FROM policy_manuals WHERE id = ? AND lab_id = ? AND archived_at IS NULL").get(id, labId) as any;
      if (!m) return { status: 404, error: "That manual isn't available in this lab." };
      const path = manualPaths(loadReadSignContext(sqlite(), labId)).get(id);
      return { scope: { type: "manual", id }, name: path || m.name };
    }
    if (type === "document") {
      const d = sqlite().prepare("SELECT id, title FROM policy_documents WHERE id = ? AND lab_id = ? AND archived_at IS NULL").get(id, labId) as any;
      if (!d) return { status: 404, error: "That document isn't available in this lab." };
      return { scope: { type: "document", id }, name: d.title };
    }
    return { status: 400, error: "Pick a document or a manual." };
  };
  const scopeFrom = (req: any, res: any, source: any) => {
    const out = resolveScope(req.scope.labId, source?.scope, source?.id);
    if ("error" in out) { res.status(out.status).json({ error: out.error }); return null; }
    return out;
  };
  const canEditIn = (req: any) => hasModuleEditAccess(req.scope.labId, req.userId, "veritapolicy");

  // Who a document, manual or the whole lab goes to now, and what can be picked.
  app.get(R, ...read, (req: any, res: any) => {
    const s = scopeFrom(req, res, req.query);
    if (!s) return;
    res.json(readSignPayload(sqlite(), req.scope.labId, s.scope, s.name, canEditIn(req)));
  });

  // Who owes and who has signed, by group and by person.
  app.get(`${R}/tracker`, ...read, (req: any, res: any) => {
    const s = scopeFrom(req, res, req.query);
    if (!s) return;
    res.json({ scope: { ...s.scope, name: s.name }, ...readSignTracker(sqlite(), req.scope.labId, s.scope) });
  });

  // Assign. Body: { scope, id, group_ids?: number[], employee_ids?: number[], everyone?: boolean }. Sends no email, ever.
  app.post(R, ...edit, (req: any, res: any) => {
    const labId = req.scope.labId;
    const db = sqlite();
    const s = scopeFrom(req, res, req.body);
    if (!s) return;
    const toInts = (v: unknown) => (Array.isArray(v) ? v : []).map(Number);
    const groupIds = [...new Set(toInts(req.body?.group_ids))];
    const employeeIds = [...new Set(toInts(req.body?.employee_ids))];
    const everyone = req.body?.everyone === true;
    if (!groupIds.length && !employeeIds.length && !everyone) return res.status(400).json({ error: "Pick a group, a person, or everyone in the lab." });
    if (s.scope.type === "document") {
      const type = db.prepare(
        `SELECT d.doc_type FROM policy_documents d JOIN policy_doc_type_settings ts ON ts.lab_id = d.lab_id AND ts.doc_type = d.doc_type
          WHERE d.id = ? AND ts.requires_read_and_sign = 0`
      ).get(s.scope.id) as any;
      if (type) return res.status(409).json({ error: "This document type doesn't need read-and-sign in this lab.", code: "TYPE_NO_READ_AND_SIGN" });
    }
    const ctx = loadReadSignContext(db, labId);
    for (const g of groupIds) if (!ctx.groupNames.has(g)) return res.status(400).json({ error: "That group isn't available in this lab.", code: "BAD_GROUP" });
    for (const e of employeeIds) if (!ctx.rosterIds.has(e)) return res.status(400).json({ error: "That person isn't on this lab's active roster.", code: "BAD_PERSON" });
    const insert = db.prepare(
      `INSERT OR IGNORE INTO policy_read_sign_assignments (lab_id, scope_type, document_id, manual_id, target_type, group_id, employee_id, assigned_by, assigned_at, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'editor')`
    );
    const docId = s.scope.type === "document" ? s.scope.id : null;
    const manualId = s.scope.type === "manual" ? s.scope.id : null;
    let added = 0;
    db.transaction(() => {
      if (everyone) added += Number(insert.run(labId, s.scope.type, docId, manualId, "everyone", null, null, req.userId).changes);
      for (const g of groupIds) added += Number(insert.run(labId, s.scope.type, docId, manualId, "group", g, null, req.userId).changes);
      for (const e of employeeIds) added += Number(insert.run(labId, s.scope.type, docId, manualId, "person", null, e, req.userId).changes);
    })();
    if (added) {
      writeAuditLog(db, {
        labId, documentId: docId, userId: req.userId, action: "read_sign_assigned",
        details: { scope: scopeKey(s.scope), scope_name: s.name, everyone, group_ids: groupIds, employee_ids: employeeIds, added, emails_sent: 0 },
        ipAddress: req.ip, userAgent: req.headers["user-agent"] as string | undefined,
      });
    }
    res.status(201).json({ added, emails_sent: 0, ...readSignPayload(db, labId, s.scope, s.name, true) });
  });

  // Take an assignment off. Nobody's signature changes; people stop owing what it gave them.
  app.delete(`${R}/:assignmentId`, ...edit, (req: any, res: any) => {
    const labId = req.scope.labId;
    const db = sqlite();
    const row = db.prepare("SELECT * FROM policy_read_sign_assignments WHERE id = ? AND lab_id = ? AND removed_at IS NULL").get(Number(req.params.assignmentId), labId) as any;
    if (!row) return res.status(404).json({ error: "That assignment isn't here." });
    db.prepare("UPDATE policy_read_sign_assignments SET removed_at = datetime('now'), removed_by = ? WHERE id = ?").run(req.userId, row.id);
    writeAuditLog(db, {
      labId, documentId: row.document_id ?? null, userId: req.userId, action: "read_sign_unassigned",
      details: { assignment_id: row.id, scope_type: row.scope_type, manual_id: row.manual_id, target_type: row.target_type, group_id: row.group_id, employee_id: row.employee_id },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] as string | undefined,
    });
    res.json({ ok: true });
  });

  // What the notice would do, in numbers, before anyone sends it.
  app.get(`${R}/notice`, ...read, (req: any, res: any) => {
    const s = scopeFrom(req, res, req.query);
    if (!s) return;
    const plan = noticePlan(sqlite(), req.scope.labId, s.scope);
    res.json({ recipients: plan.recipients.length, no_login_or_address: plan.no_login_or_address, sent_recently_at: plan.sent_recently_at, cooldown_hours: NOTICE_COOLDOWN_HOURS });
  });

  // Send the notice. Body: { scope, id, confirm_count }. confirm_count is the count the editor saw.
  app.post(`${R}/notice`, ...edit, (req: any, res: any) => {
    const labId = req.scope.labId;
    const db = sqlite();
    const s = scopeFrom(req, res, req.body);
    if (!s) return;
    const plan = noticePlan(db, labId, s.scope);
    if (plan.sent_recently_at) return res.status(409).json({ error: `A notice for this already went out in the last ${NOTICE_COOLDOWN_HOURS} hours.`, code: "NOTICE_RECENT" });
    if (Number(req.body?.confirm_count) !== plan.recipients.length) {
      return res.status(409).json({ error: "The list changed. Check the new count before sending.", code: "COUNT_CHANGED", recipients: plan.recipients.length });
    }
    if (!plan.recipients.length) return res.status(400).json({ error: "Nobody on this list owes a signature and can sign in.", code: "NO_RECIPIENTS" });
    writeAuditLog(db, {
      labId, documentId: s.scope.type === "document" ? s.scope.id : null, userId: req.userId, action: "read_sign_notice_sent",
      details: { scope: scopeKey(s.scope), scope_name: s.name, recipients: plan.recipients.length },
      ipAddress: req.ip, userAgent: req.headers["user-agent"] as string | undefined,
    });
    // Sent in the background: at Resend's pace a long list outlasts the request.
    res.status(202).json({ sending: plan.recipients.length });
    sendNotice(db, labId, req.userId, s.scope, plan.recipients).catch((err) => console.error("[read-sign notice]", err?.message || err));
  });

  // Counts only, for checking after a deploy without touching a lab's access log (lab-scoped GETs write record_views). No names, no titles.
  app.get("/api/admin/veritadc/read-sign/status", (req: any, res: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!secret || secret !== process.env.ADMIN_SECRET) return res.status(403).json({ error: "Forbidden" });
    const labId = Number(req.query.labId);
    const n = (sql: string, ...args: any[]) => Number((sqlite().prepare(sql).get(...args) as any)?.n || 0);
    if (Number.isInteger(labId) && labId > 0) {
      const byKind = sqlite().prepare("SELECT scope_type, target_type, origin, COUNT(*) AS n FROM policy_read_sign_assignments WHERE lab_id = ? AND removed_at IS NULL GROUP BY scope_type, target_type, origin").all(labId);
      return res.json({
        labId,
        assignments: byKind,
        groups: n("SELECT COUNT(*) AS n FROM lab_groups WHERE lab_id = ? AND retired = 0", labId),
        approvedDocuments: n("SELECT COUNT(*) AS n FROM policy_documents WHERE lab_id = ? AND status = 'approved' AND archived_at IS NULL", labId),
        staffSeats: n("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal' AND status IN ('active','pending')", labId),
      });
    }
    res.json({
      keptAsTheyWere: (sqlite().prepare("SELECT lab_id FROM policy_read_sign_assignments WHERE origin = 'kept_as_it_was' AND removed_at IS NULL ORDER BY lab_id").all() as any[]).map((r) => r.lab_id),
      labsWithAssignments: n("SELECT COUNT(DISTINCT lab_id) AS n FROM policy_read_sign_assignments WHERE removed_at IS NULL"),
      assignments: n("SELECT COUNT(*) AS n FROM policy_read_sign_assignments WHERE removed_at IS NULL"),
    });
  });
}
