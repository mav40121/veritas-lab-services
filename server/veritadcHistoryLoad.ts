// server/veritadcHistoryLoad.ts
//
// Carry a lab's read-and-sign history over from its prior system (Michael 2026-11-06, Q207 = 1; Heywood's MediaLab report). scripts/
// veritadc-history-load.mts drives it, in the same shape as the document load (server/veritadcBulkLoad.ts): a dry run reads, and a real
// load needs --apply and, on production, --go.
//
// What a row becomes: a policy_prior_signatures row with the original date and the version named in the report. It says where it came
// from on every screen, and no staff_portal_policy_signatures, policy_attestations or policy_signoffs row is written, because these people
// did not sign in VeritaAssure.
//
// What the load never does: send email, assign read-and-sign, or create a login, a seat or a roster row. An open row in the report isn't
// sent here at all: the person owes that document when the lab assigns it, because no signature answers it. The script lists them.
//
// The server re-checks each row, so a mistake in the script can't put a signature on the wrong person: the document must be one this lab
// carried over, the person must be on this lab's active roster, and the name must match that roster row unless a person chose the match.
// Safe to rerun: a row already here is recognized and left alone, except that a person's later choice can link a row kept as history.

import { db } from "./db";
import { docNumberKey } from "../shared/policyVersion";
import { MAX_ROWS_PER_BATCH, PERSON_STATES, indexRoster, matchPerson, personKey, priorBatchProblem, priorDate, priorVersionRelation, type PriorSignatureBatch, type PriorSignatureRow } from "../shared/policyPriorSignature";
import { writeAuditLog } from "./veritapolicyApproval";
import { staffLabIdFor } from "./policyReadSign";

type RowResult = { i: number; result: "loaded" | "already_loaded" | "linked" | "failed"; code?: string; documentId?: number; counts?: boolean };

export function loadPriorSignatures(sqlite: any, input: PriorSignatureBatch) {
  const lab = sqlite.prepare("SELECT id, lab_name, owner_user_id FROM labs WHERE id = ?").get(input.labId) as { id: number; lab_name: string | null; owner_user_id: number } | undefined;
  if (!lab) return { status: 404, body: { error: "That lab doesn't exist.", code: "LAB_NOT_FOUND" } };
  // The name is checked so a wrong lab id can never put one customer's history in another customer's lab.
  if ((lab.lab_name || "") !== input.expectedLabName) return { status: 409, body: { error: "That lab id doesn't match the lab name in the plan.", code: "LAB_MISMATCH" } };
  const ownerIsOnLab = lab.owner_user_id === input.ownerUserId
    || !!sqlite.prepare("SELECT 1 FROM lab_members WHERE lab_id = ? AND user_id = ? AND status = 'active' LIMIT 1").get(input.labId, input.ownerUserId);
  if (!ownerIsOnLab) return { status: 400, body: { error: "The owner named in the plan isn't an active member of this lab.", code: "OWNER_NOT_ON_LAB" } };

  const carried = new Map<string, { document_id: number; version_id: number; source_version: string }>();
  for (const c of sqlite.prepare("SELECT document_id, version_id, source_number, source_version FROM policy_carried_records WHERE lab_id = ?").all(input.labId) as any[]) {
    carried.set(docNumberKey(String(c.source_number)), c);
  }
  const staffLab = staffLabIdFor(sqlite, input.labId);
  const roster = staffLab == null ? [] : sqlite.prepare("SELECT id, last_name, first_name, middle_initial FROM staff_employees WHERE lab_id = ? AND status = 'active'").all(staffLab) as any[];
  const rosterIds = new Set<number>(roster.map((e) => e.id));
  const rosterIndex = indexRoster(roster);
  const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // a day's grace for time zones

  const find = sqlite.prepare(
    `SELECT id, staff_employee_id FROM policy_prior_signatures
      WHERE lab_id = ? AND document_id = ? AND name_key = ? AND source_version = ? AND signed_on = ? AND COALESCE(assigned_on, '') = ?`
  );
  const insert = sqlite.prepare(
    `INSERT INTO policy_prior_signatures
       (lab_id, document_id, version_id, staff_employee_id, person_state, source_system, source_name, name_key, source_credentials,
        source_number, source_version, source_type, assigned_on, signed_on, batch, loaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const link = sqlite.prepare("UPDATE policy_prior_signatures SET staff_employee_id = ?, person_state = 'on_roster' WHERE id = ? AND staff_employee_id IS NULL");

  const results: RowResult[] = [];
  const perDocument = new Map<number, number>();
  const fail = (i: number, code: string) => results.push({ i, result: "failed", code });

  const oneRow = (row: PriorSignatureRow, i: number) => {
    if (!row || typeof row !== "object") return fail(i, "BAD_ROW");
    const name = String(row.personName ?? "").trim();
    if (!name) return fail(i, "NO_NAME");
    if (!PERSON_STATES.includes(row.personState)) return fail(i, "BAD_PERSON_STATE");
    const signedOn = priorDate(row.signedOn);
    if (!signedOn || signedOn > today) return fail(i, "BAD_DATE");
    const assignedOn = row.assignedOn ? priorDate(row.assignedOn) : null;
    if (row.assignedOn && !assignedOn) return fail(i, "BAD_DATE");
    const doc = carried.get(docNumberKey(String(row.docNumber ?? "")));
    if (!doc) return fail(i, "DOCUMENT_NOT_LOADED");
    const relation = priorVersionRelation(row.version, doc.source_version);
    if (relation === "bad") return fail(i, "BAD_VERSION");
    if (relation === "newer") return fail(i, "VERSION_NEWER_THAN_LOADED");

    let employeeId: number | null = null;
    if (row.personState === "on_roster") {
      employeeId = Number(row.employeeId);
      if (!rosterIds.has(employeeId)) return fail(i, "PERSON_NOT_ON_ROSTER");
      // The name must be this roster row, unless a person looked and chose it.
      const match = matchPerson(name, rosterIndex);
      if (!row.confirmedByPerson && !(match.kind === "one" && match.employeeId === employeeId)) return fail(i, "PERSON_NAME_MISMATCH");
    } else if (row.employeeId != null) {
      return fail(i, "HISTORY_ROW_NAMES_A_PERSON");
    }

    const key = personKey(name);
    const version = String(row.version).trim();
    const existing = find.get(input.labId, doc.document_id, key, version, signedOn, assignedOn ?? "") as { id: number; staff_employee_id: number | null } | undefined;
    if (existing) {
      if (existing.staff_employee_id == null && employeeId != null) {
        link.run(employeeId, existing.id);
        results.push({ i, result: "linked", documentId: doc.document_id, counts: relation === "counts" });
      } else {
        results.push({ i, result: "already_loaded", documentId: doc.document_id, counts: relation === "counts" });
      }
      return;
    }
    insert.run(
      input.labId, doc.document_id, relation === "counts" ? doc.version_id : null, employeeId, row.personState, input.sourceSystem, name, key,
      row.credentials ? String(row.credentials).trim() : null, String(row.docNumber).trim(), version,
      row.sourceType ? String(row.sourceType).trim() : null, assignedOn, signedOn, input.batch, input.loadedBy
    );
    perDocument.set(doc.document_id, (perDocument.get(doc.document_id) || 0) + 1);
    results.push({ i, result: "loaded", documentId: doc.document_id, counts: relation === "counts" });
  };

  sqlite.transaction(() => {
    input.rows.forEach((row, i) => oneRow(row, i));
    // loaded_by comes first because the audit trail screen shows the first few details. No names here.
    for (const [documentId, rows] of perDocument) {
      writeAuditLog(sqlite, {
        labId: input.labId,
        documentId,
        userId: input.ownerUserId,
        action: "prior_signatures_carried_over",
        details: { loaded_by: input.loadedBy, source_system: input.sourceSystem, rows, batch: input.batch, emails_sent: 0 },
      });
    }
  })();

  const counts: Record<string, number> = {};
  for (const r of results) counts[r.result] = (counts[r.result] || 0) + 1;
  return { status: 200, body: { labId: input.labId, counts, results } };
}

/** Counts only, for the script's preflight and the check after a load. No names. */
export function priorSignatureStatus(sqlite: any, labId: number) {
  const lab = sqlite.prepare("SELECT id, lab_name, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) return null;
  const n = (sql: string, ...args: unknown[]) => Number((sqlite.prepare(sql).get(...args) as { n: number }).n);
  return {
    labId,
    labName: lab.lab_name,
    ownerUserId: lab.owner_user_id,
    rows: n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE lab_id = ?", labId),
    linkedToRoster: n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE lab_id = ? AND staff_employee_id IS NOT NULL", labId),
    countAsSigned: n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE lab_id = ? AND staff_employee_id IS NOT NULL AND version_id IS NOT NULL", labId),
    historyOnly: n("SELECT COUNT(*) AS n FROM policy_prior_signatures WHERE lab_id = ? AND (staff_employee_id IS NULL OR version_id IS NULL)", labId),
    byPersonState: Object.fromEntries((sqlite.prepare("SELECT person_state AS s, COUNT(*) AS n FROM policy_prior_signatures WHERE lab_id = ? GROUP BY person_state").all(labId) as any[]).map((r) => [r.s, r.n])),
    documents: n("SELECT COUNT(DISTINCT document_id) AS n FROM policy_prior_signatures WHERE lab_id = ?", labId),
    // These don't move during a load: nobody signs, nobody is assigned, nobody gets a login.
    unchanged: {
      staffSignatures: n("SELECT COUNT(*) AS n FROM staff_portal_policy_signatures WHERE lab_id = ?", labId),
      attestations: n("SELECT COUNT(*) AS n FROM policy_attestations a JOIN policy_documents d ON d.id = a.document_id WHERE d.lab_id = ?", labId),
      readSignAssignments: n("SELECT COUNT(*) AS n FROM policy_read_sign_assignments WHERE lab_id = ? AND removed_at IS NULL", labId),
      staffSeats: n("SELECT COUNT(*) AS n FROM user_seats WHERE lab_id = ? AND seat_type = 'staff_portal'", labId),
    },
  };
}

/** What the script matches against, read from production without a lab-scoped GET. Holds names, so only the script's results file gets them. */
export function priorSignatureReference(sqlite: any, labId: number) {
  const lab = sqlite.prepare("SELECT id, lab_name, owner_user_id FROM labs WHERE id = ?").get(labId) as any;
  if (!lab) return null;
  const staffLab = staffLabIdFor(sqlite, labId);
  return {
    labId,
    labName: lab.lab_name,
    ownerUserId: lab.owner_user_id,
    roster: staffLab == null ? [] : sqlite.prepare("SELECT id, last_name, first_name, middle_initial FROM staff_employees WHERE lab_id = ? AND status = 'active'").all(staffLab),
    documents: sqlite.prepare("SELECT source_number AS number, source_version AS version, document_id FROM policy_carried_records WHERE lab_id = ?").all(labId),
  };
}

export function registerHistoryLoadRoutes(app: any, deps: { adminSecret: string | undefined }) {
  const sqlite = () => (db as any).$client;
  const adminOnly = (req: any, res: any, next: any) => {
    const secret = req.headers["x-admin-secret"] as string | undefined;
    if (!deps.adminSecret || !secret || secret !== deps.adminSecret) return res.status(403).json({ error: "Forbidden" });
    next();
  };

  // POST /api/admin/veritadc/history-load/rows. JSON: shared/policyPriorSignature.ts PriorSignatureBatch.
  app.post("/api/admin/veritadc/history-load/rows", adminOnly, (req: any, res: any) => {
    const problem = priorBatchProblem(req.body);
    if (problem) return res.status(400).json({ error: problem, code: "BAD_BATCH", maxRows: MAX_ROWS_PER_BATCH });
    const out = loadPriorSignatures(sqlite(), req.body as PriorSignatureBatch);
    res.status(out.status).json(out.body);
  });

  app.get("/api/admin/veritadc/history-load/status", adminOnly, (req: any, res: any) => {
    const labId = Number(req.query.labId);
    if (!Number.isInteger(labId) || labId <= 0) return res.status(400).json({ error: "labId required" });
    const out = priorSignatureStatus(sqlite(), labId);
    if (!out) return res.status(404).json({ error: "Lab not found" });
    res.json(out);
  });

  app.get("/api/admin/veritadc/history-load/reference", adminOnly, (req: any, res: any) => {
    const labId = Number(req.query.labId);
    if (!Number.isInteger(labId) || labId <= 0) return res.status(400).json({ error: "labId required" });
    const out = priorSignatureReference(sqlite(), labId);
    if (!out) return res.status(404).json({ error: "Lab not found" });
    res.setHeader("Cache-Control", "no-store");
    res.json(out);
  });
}
