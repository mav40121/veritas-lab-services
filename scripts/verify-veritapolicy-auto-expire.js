#!/usr/bin/env node
// verify-veritapolicy-auto-expire.js
//
// Offline contract tests for runPolicyAutoExpire in
// server/veritapolicyReminders.ts. Seeds an in-memory SQLite DB with
// a known set of approved + expired + draft policies at varied
// next_review_date offsets, then exercises the WHERE clause + UPDATE
// + audit-log shape that ship in PR for #39 sub-item (auto-expire
// deferred from Phase 6B).
//
// What this script proves:
//
//  1. Grace window: docs past next_review_date by MORE than 60 days
//     flip; docs exactly at or within the 60-day window do NOT flip.
//  2. Status filter: only status='approved' rows are considered.
//     draft, in_review, expired, archived are all skipped.
//  3. archived_at: rows with archived_at NOT NULL are skipped even
//     when otherwise eligible.
//  4. Audit-log write: every flip produces a policy_audit_log row
//     with action='auto_expired' and the previous_status + grace_days
//     baked into details.
//  5. Idempotency: re-running on the same dataset is a no-op —
//     stats.scanned and stats.flipped both go to 0 because the
//     flipped rows now have status='expired' and don't match the
//     WHERE clause.
//
// Pattern mirrors scripts/verify-veritaqc-import.js.

import Database from "better-sqlite3";

const db = new Database(":memory:");
db.pragma("foreign_keys = ON");

// ── Minimal schema mirror ────────────────────────────────────────
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY);
  CREATE TABLE policy_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    owner_user_id INTEGER,
    next_review_date TEXT,
    archived_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE policy_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL,
    document_id INTEGER,
    user_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

db.prepare("INSERT INTO labs (id) VALUES (1)").run();

function isoDaysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

const ins = db.prepare(
  "INSERT INTO policy_documents (lab_id, title, status, owner_user_id, next_review_date, archived_at) VALUES (?, ?, ?, ?, ?, ?)"
);

// Eligible rows (status=approved, past grace, not archived) — should flip:
const doc100PastApproved = ins.run(1, "100 days overdue, approved", "approved", 5, isoDaysFromNow(-100), null).lastInsertRowid;
const doc70PastApproved  = ins.run(1, "70 days overdue, approved",  "approved", 5, isoDaysFromNow(-70),  null).lastInsertRowid;

// Not-yet eligible (within grace) — should NOT flip:
const doc59PastApproved  = ins.run(1, "59 days overdue, approved",  "approved", 5, isoDaysFromNow(-59),  null).lastInsertRowid;
const docExactlyDueApproved = ins.run(1, "exactly due, approved",   "approved", 5, isoDaysFromNow(0),    null).lastInsertRowid;
const docFutureApproved  = ins.run(1, "due in 30 days, approved",   "approved", 5, isoDaysFromNow(30),   null).lastInsertRowid;

// Wrong status — should NOT flip even when past grace:
const doc100PastDraft    = ins.run(1, "100 days overdue, draft",    "draft",    5, isoDaysFromNow(-100), null).lastInsertRowid;
const doc100PastReview   = ins.run(1, "100 days overdue, in_review","in_review",5, isoDaysFromNow(-100), null).lastInsertRowid;
const doc100PastExpired  = ins.run(1, "100 days overdue, expired",  "expired",  5, isoDaysFromNow(-100), null).lastInsertRowid;

// Archived row — should NOT flip even when otherwise eligible:
const doc100PastArchived = ins.run(1, "100 days overdue, approved but archived", "approved", 5, isoDaysFromNow(-100), isoDaysFromNow(-5)).lastInsertRowid;

// Reproduce the function under test locally (it lives in the server
// build and pulls server-only imports; this script tests the SAME
// query + update + audit-log writes against the in-memory schema).
const AUTO_EXPIRE_GRACE_DAYS = 60;
const SYSTEM_USER_ID = -1;

function runPolicyAutoExpireLocal() {
  const stats = { scanned: 0, flipped: 0, skipped: 0, errors: 0 };
  const rows = db.prepare(
    `SELECT d.id, d.lab_id, d.title, d.owner_user_id, d.next_review_date
       FROM policy_documents d
      WHERE d.archived_at IS NULL
        AND d.status = 'approved'
        AND d.next_review_date IS NOT NULL
        AND date(d.next_review_date) < date('now', '-' || ? || ' days')`
  ).all(AUTO_EXPIRE_GRACE_DAYS);

  for (const r of rows) {
    stats.scanned += 1;
    try {
      const result = db.prepare(
        `UPDATE policy_documents
            SET status = 'expired', updated_at = datetime('now')
          WHERE id = ? AND status = 'approved'`
      ).run(r.id);
      if (result.changes !== 1) {
        stats.skipped += 1;
        continue;
      }
      stats.flipped += 1;
      db.prepare(
        `INSERT INTO policy_audit_log (lab_id, document_id, user_id, action, details)
         VALUES (?, ?, ?, ?, ?)`
      ).run(
        r.lab_id,
        r.id,
        SYSTEM_USER_ID,
        "auto_expired",
        JSON.stringify({
          previous_status: "approved",
          next_review_date: r.next_review_date,
          grace_days: AUTO_EXPIRE_GRACE_DAYS,
          reason: "next_review_date past by more than grace window",
        })
      );
    } catch (err) {
      stats.errors += 1;
    }
  }
  return stats;
}

// ── Test runner
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

// 1. First run: scans + flips the 2 eligible rows.
const first = runPolicyAutoExpireLocal();
check("first run: scanned 2 eligible rows", first.scanned === 2, `got scanned=${first.scanned}`);
check("first run: flipped 2 eligible rows", first.flipped === 2);
check("first run: 0 skipped",  first.skipped === 0);
check("first run: 0 errors",   first.errors === 0);

// 2. The 2 eligible rows are now status='expired'.
const flipped100 = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(doc100PastApproved);
const flipped70  = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(doc70PastApproved);
check("doc 100d past flipped to expired", flipped100.status === "expired");
check("doc 70d  past flipped to expired", flipped70.status === "expired");

// 3. Grace-window rows untouched (still approved).
const stayed59 = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(doc59PastApproved);
const stayedExact = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(docExactlyDueApproved);
const stayedFuture = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(docFutureApproved);
check("doc 59d past (within grace) still approved", stayed59.status === "approved");
check("doc exactly due still approved", stayedExact.status === "approved");
check("doc due in 30d still approved", stayedFuture.status === "approved");

// 4. Wrong-status rows untouched.
const stayedDraft = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(doc100PastDraft);
const stayedReview = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(doc100PastReview);
const stayedExpired = db.prepare("SELECT status FROM policy_documents WHERE id = ?").get(doc100PastExpired);
check("doc draft past grace still draft", stayedDraft.status === "draft");
check("doc in_review past grace still in_review", stayedReview.status === "in_review");
check("doc expired past grace still expired (no double-flip)", stayedExpired.status === "expired");

// 5. Archived row untouched.
const stayedArchived = db.prepare("SELECT status, archived_at FROM policy_documents WHERE id = ?").get(doc100PastArchived);
check("doc archived + past grace still approved (excluded)", stayedArchived.status === "approved");
check("doc archived has archived_at set", stayedArchived.archived_at !== null);

// 6. Audit log: exactly 2 'auto_expired' entries.
const auditRows = db.prepare(
  "SELECT document_id, action, details FROM policy_audit_log WHERE action = 'auto_expired' ORDER BY document_id ASC"
).all();
check("audit log: 2 auto_expired entries", auditRows.length === 2);
for (const a of auditRows) {
  const details = JSON.parse(a.details);
  check(`audit row doc=${a.document_id}: previous_status=approved`, details.previous_status === "approved");
  check(`audit row doc=${a.document_id}: grace_days=60`, details.grace_days === 60);
  check(`audit row doc=${a.document_id}: has next_review_date`, typeof details.next_review_date === "string");
  check(`audit row doc=${a.document_id}: reason present`, typeof details.reason === "string" && details.reason.length > 0);
}

// 7. Idempotency: second run does nothing.
const second = runPolicyAutoExpireLocal();
check("second run: scanned 0 (idempotent)", second.scanned === 0);
check("second run: flipped 0", second.flipped === 0);
check("second run: 0 errors", second.errors === 0);

// 8. Audit log unchanged after second run.
const auditRowsAfter = db.prepare(
  "SELECT COUNT(*) AS n FROM policy_audit_log WHERE action = 'auto_expired'"
).get();
check("audit log: still 2 entries after second run", auditRowsAfter.n === 2);

// ── Report
console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
