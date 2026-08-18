#!/usr/bin/env node
/**
 * verify-policy-notes.js
 *
 * Receipt for VeritaPolicy per-policy notes (2026-08-17). A lab member posts
 * free-form notes on a policy document; the note author or the policy owner may
 * remove one (soft-delete -> tombstone). This mirrors the branching logic in
 * server/routes.ts (POST/DELETE /veritapolicy/documents/:id/notes) so the
 * permission, tombstone, and validation rules are exercised on known inputs.
 * Keep in sync with the route handlers.
 */

// --- mirrors of the server predicates -----------------------------------

// Who may remove a note: the author or the policy's owner, and only if the
// note is not already removed.
function canDelete({ noteAuthorId, docOwnerId, deletedAt }, viewerId) {
  return !deletedAt && (noteAuthorId === viewerId || docOwnerId === viewerId);
}

// What the GET endpoint returns as the body: withheld once removed.
function bodyForClient(row) {
  return row.deleted_at ? null : row.body;
}

// POST validation: trim, require non-empty, cap at 5000 chars. Returns the
// stored body, or an { error } object.
function validateNoteBody(raw) {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return { error: "Note text required" };
  if (body.length > 5000) return { error: "Note too long (5000 character max)" };
  return { body };
}

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}  (got ${a}, expected ${e})`);
}

const AUTHOR = 42, OWNER = 7, BYSTANDER = 99;

console.log("== can_delete: author or policy owner, not already removed ==");
check("author can delete own live note", canDelete({ noteAuthorId: AUTHOR, docOwnerId: OWNER, deletedAt: null }, AUTHOR), true);
check("policy owner can delete another's live note", canDelete({ noteAuthorId: AUTHOR, docOwnerId: OWNER, deletedAt: null }, OWNER), true);
check("bystander cannot delete", canDelete({ noteAuthorId: AUTHOR, docOwnerId: OWNER, deletedAt: null }, BYSTANDER), false);
check("nobody can delete an already-removed note (author)", canDelete({ noteAuthorId: AUTHOR, docOwnerId: OWNER, deletedAt: "2026-08-17" }, AUTHOR), false);
check("nobody can delete an already-removed note (owner)", canDelete({ noteAuthorId: AUTHOR, docOwnerId: OWNER, deletedAt: "2026-08-17" }, OWNER), false);

console.log("\n== tombstone: removed note withholds its body ==");
check("live note returns its body", bodyForClient({ body: "please clarify section 3", deleted_at: null }), "please clarify section 3");
check("removed note returns null body", bodyForClient({ body: "please clarify section 3", deleted_at: "2026-08-17" }), null);

console.log("\n== POST validation ==");
check("normal note accepted (trimmed)", validateNoteBody("  looks good to me  "), { body: "looks good to me" });
check("empty string rejected", validateNoteBody(""), { error: "Note text required" });
check("whitespace-only rejected", validateNoteBody("   \n\t "), { error: "Note text required" });
check("non-string rejected", validateNoteBody(undefined), { error: "Note text required" });
check("5000 chars accepted", validateNoteBody("x".repeat(5000)).body?.length, 5000);
check("5001 chars rejected", validateNoteBody("x".repeat(5001)), { error: "Note too long (5000 character max)" });

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
