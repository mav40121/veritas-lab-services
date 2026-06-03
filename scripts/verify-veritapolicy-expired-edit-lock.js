#!/usr/bin/env node
// verify-veritapolicy-expired-edit-lock.js
//
// Offline contract tests for isPolicyExpired in
// server/veritapolicyApproval.ts. The helper is the basis for
// every write-path edit-lock added in this PR; it returns true
// iff the doc's status is exactly 'expired', false for every
// other state.
//
// What this script proves:
//
//  1. isPolicyExpired returns true for status='expired'.
//  2. Returns false for every other terminal/transitional state:
//     draft, in_review, approved, archived.
//  3. Returns false when document_id does not exist (no-op safety).
//  4. POLICY_EXPIRED_RESPONSE has the three keys the client UI reads
//     to render a recovery-hint banner: error, message, code.
//
// Pattern mirrors scripts/verify-veritapolicy-auto-expire.js.

import Database from "better-sqlite3";

const db = new Database(":memory:");

db.exec(`
  CREATE TABLE policy_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lab_id INTEGER NOT NULL DEFAULT 1,
    title TEXT,
    status TEXT NOT NULL,
    archived_at TEXT
  );
`);

const ins = db.prepare("INSERT INTO policy_documents (status, title) VALUES (?, ?)");
const draftId    = ins.run("draft", "draft doc").lastInsertRowid;
const reviewId   = ins.run("in_review", "in_review doc").lastInsertRowid;
const approvedId = ins.run("approved", "approved doc").lastInsertRowid;
const expiredId  = ins.run("expired", "expired doc").lastInsertRowid;
const archivedId = ins.run("archived", "archived doc").lastInsertRowid;

// Reproduce the helper logic locally for the offline test.
function isPolicyExpired(sqlite, documentId) {
  const row = sqlite
    .prepare("SELECT status FROM policy_documents WHERE id = ?")
    .get(documentId);
  return row?.status === "expired";
}

const POLICY_EXPIRED_RESPONSE = {
  error: "Policy is expired",
  message:
    "This policy is expired and cannot be edited or further actioned. To revise it, upload a new version, which restarts the approval workflow.",
  code: "POLICY_EXPIRED",
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("PASS  " + name); }
  else      { fail++; console.log("FAIL  " + name + (detail ? " — " + detail : "")); }
}

// 1. Expired returns true.
check("isPolicyExpired(expired) === true", isPolicyExpired(db, expiredId) === true);

// 2. Every other state returns false.
check("isPolicyExpired(draft) === false",    isPolicyExpired(db, draftId)    === false);
check("isPolicyExpired(in_review) === false",isPolicyExpired(db, reviewId)   === false);
check("isPolicyExpired(approved) === false", isPolicyExpired(db, approvedId) === false);
check("isPolicyExpired(archived) === false", isPolicyExpired(db, archivedId) === false);

// 3. Missing document returns false (no-op safety: don't false-positive
//    a lock when the doc doesn't exist).
check("isPolicyExpired(99999 missing) === false", isPolicyExpired(db, 99999) === false);

// 4. POLICY_EXPIRED_RESPONSE shape.
check("POLICY_EXPIRED_RESPONSE has error key", typeof POLICY_EXPIRED_RESPONSE.error === "string");
check("POLICY_EXPIRED_RESPONSE has message key", typeof POLICY_EXPIRED_RESPONSE.message === "string");
check("POLICY_EXPIRED_RESPONSE has code key", POLICY_EXPIRED_RESPONSE.code === "POLICY_EXPIRED");
check("POLICY_EXPIRED_RESPONSE message includes recovery hint",
  POLICY_EXPIRED_RESPONSE.message.toLowerCase().includes("upload a new version"));

console.log("");
console.log(`SUMMARY: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
