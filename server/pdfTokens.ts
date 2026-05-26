// SQLite-backed PDF token store. Used by every PDF-generating route in the
// codebase (~25 callers across VeritaCheck, VeritaScan, VeritaComp,
// VeritaStaff, CUMSUM, CMS 209, VeritaPT, VeritaBench reorder, VeritaStock
// Snap Order, VeritaResponse, VeritaOps CPRT, and the demo paths).
//
// Why a token dance instead of streaming the PDF inline: native browser
// downloads bypass Adobe Acrobat's blob:// interception, which intermittently
// hijacked downloads in earlier revisions. The POST mints a token; the GET at
// /api/pdf/:token claims it and streams the buffer. The GET is a plain
// browser-driven request, which is what dodges the Acrobat blob hijack.
//
// Why SQLite instead of an in-memory Map:
//
//   - In-memory state is erased by every server restart (deploys, OOM,
//     idle-reap on Railway). A token minted 200ms before a deploy boundary
//     is gone before the browser navigates, and the user sees
//     "PDF token expired or not found" with no recovery path.
//   - In-memory state is also per-process. The moment Railway scales the
//     `radiant-quietude` service past 1 replica, POST and GET will land on
//     different processes and the token lookup will miss.
//
// SQLite-backed tokens survive both. The opportunistic prune on every mint
// keeps the table bounded to the unclaimed-but-not-yet-expired window.
//
// Token semantics:
//   - 300s TTL (was 60s in the in-memory version; bumped 2026-05-XX for the
//     cold-puppeteer-launch case where the POST itself takes 30-60s).
//   - Single-use: a successful claim deletes the row. A failed claim against
//     an expired token also deletes the row (cleanup).
//   - UUID v4 (crypto.randomUUID), unguessable.

import crypto from "crypto";
import { db } from "./db";

export interface PdfTokenEntry { buffer: Buffer; filename: string; expires: number; }

const TOKEN_EXPIRY_MS = 300_000;

// Drizzle exposes the underlying better-sqlite3 handle as $client.
// (Same pattern used in server/routes.ts for raw queries.)
function sqlite(): import("better-sqlite3").Database {
  return (db as any).$client;
}

// Prepared statements are cached after first use. Lazy-init because this
// module can be required before db.ts has finished its CREATE TABLE block
// during boot, and prepare() would throw on a missing table.
let _insertStmt: any = null;
let _selectStmt: any = null;
let _deleteStmt: any = null;
let _pruneStmt: any = null;

function stmts() {
  if (!_insertStmt) {
    const s = sqlite();
    _insertStmt = s.prepare("INSERT INTO pdf_tokens (token, buffer, filename, expires) VALUES (?, ?, ?, ?)");
    _selectStmt = s.prepare("SELECT buffer, filename, expires FROM pdf_tokens WHERE token = ?");
    _deleteStmt = s.prepare("DELETE FROM pdf_tokens WHERE token = ?");
    _pruneStmt  = s.prepare("DELETE FROM pdf_tokens WHERE expires < ?");
  }
  return { insertStmt: _insertStmt, selectStmt: _selectStmt, deleteStmt: _deleteStmt, pruneStmt: _pruneStmt };
}

// Mint a new token for the given PDF buffer + filename. Returns the UUID
// the caller should hand the browser to GET. Signature is identical to the
// pre-SQLite Map-backed version, so the ~25 existing call sites need no
// change.
export function storePdfToken(buffer: Buffer, filename: string): string {
  const token = crypto.randomUUID();
  const expires = Date.now() + TOKEN_EXPIRY_MS;
  const { insertStmt, pruneStmt } = stmts();
  insertStmt.run(token, buffer, filename, expires);
  // Opportunistic prune of expired rows. Bounded by the indexed expires col.
  try { pruneStmt.run(Date.now()); } catch {}
  return token;
}

// Single-use claim. Returns the token's PDF buffer + filename on success,
// or null if the token is missing or already expired. Deletes the row
// either way (so an expired-token lookup also cleans up).
//
// Used by the GET /api/pdf/:token handler in server/routes.ts.
export function claimPdfToken(token: string): PdfTokenEntry | null {
  const { selectStmt, deleteStmt } = stmts();
  const row = selectStmt.get(token) as { buffer: Buffer; filename: string; expires: number } | undefined;
  if (!row) return null;
  try { deleteStmt.run(token); } catch {}
  if (row.expires < Date.now()) return null;
  return { buffer: row.buffer, filename: row.filename, expires: row.expires };
}
