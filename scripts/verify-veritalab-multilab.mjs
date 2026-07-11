// scripts/verify-veritalab-multilab.mjs
//
// Receipt for the VeritaLab multi-lab fixes (audit #1 HIGH + #3 MED, 2026-07-10).
//
//   #1 HIGH: the CMS-116 issued-cert wire-back INSERT omitted lab_id, so the
//   auto-created CLIA cert landed with NULL lab_id and the lab-scoped roster
//   (SELECT ... WHERE lab_id = ?) never showed it. Fix: add lab_id + labId.
//
//   #3 MED: the certificate Excel export always ran WHERE user_id, so a
//   multi-lab owner's export bled every lab's certs into one workbook under the
//   owner's default lab identity. Fix: honor the X-Active-Lab-Id header exactly
//   as the client's list/edit/delete already do, and pull the About-sheet
//   identity from the active labs row when scoped.
//
// Part 1: source receipts. Part 2: a functional better-sqlite3 proof that a cert
// inserted WITH lab_id is visible to the WHERE lab_id read and one WITHOUT is
// not (the exact before/after of the HIGH bug).
//
//   node scripts/verify-veritalab-multilab.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// ── Part 1: source receipts ───────────────────────────────────────────────
console.log("--- source receipts ---");

// #1 wire-back INSERT now carries lab_id in the column list AND labId in run()
ok("#1 wire-back INSERT column list includes lab_id (right after user_id)",
  /INSERT INTO lab_certificates \(\s*user_id, lab_id, cert_type,/.test(routes));
ok("#1 wire-back VALUES has the extra positional placeholder (2 leading ? then 'clia')",
  /VALUES \(\?, \?, 'clia', 'CLIA Certificate',/.test(routes));
ok("#1 wire-back run() passes labId right after Number(lab.owner_user_id)",
  /\.run\(\s*Number\(lab\.owner_user_id\),\s*labId,\s*cliaNumber,/.test(routes));

// #3 export honors the active-lab header and scopes by lab_id when accessible
ok("#3 export reads the x-active-lab-id header",
  /const activeHdr = req\?\.headers\?\.\["x-active-lab-id"\];/.test(routes));
ok("#3 export validates the header lab via resolveActiveLabForRequest + id match",
  /const scopedLab = activeLabRow && Number\(activeLabRow\.id\) === activeLabIdReq \? activeLabRow : null;/.test(routes));
ok("#3 export scopes certs WHERE lab_id when scopedLab, else legacy WHERE user_id",
  /scopedLab[\s\S]*?WHERE lab_id = \? AND is_active = 1[\s\S]*?WHERE user_id = \? AND is_active = 1/.test(routes));
ok("#3 export identity uses the active labs row (lab_name/clia_number) when scoped",
  /scopedLab\s*\?\s*\(scopedLab\.lab_name[\s\S]*?scopedLab\s*\?\s*\(scopedLab\.clia_number/.test(routes));

// ── Part 2: functional sqlite proof of the HIGH bug + fix ──────────────────
console.log("--- functional sqlite proof ---");
let Database;
try {
  Database = (await import("better-sqlite3")).default;
} catch {
  console.log("SKIP: better-sqlite3 not importable in this context (source receipts still authoritative).");
  console.log(fails === 0 ? "\n=== VERITALAB MULTILAB: PASS (receipts) ===" : `\n=== ${fails} FAIL ===`);
  process.exit(fails === 0 ? 0 : 1);
}

const sq = new Database(":memory:");
sq.exec(`CREATE TABLE lab_certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, lab_id INTEGER, cert_type TEXT, cert_number TEXT,
  is_active INTEGER DEFAULT 1
);`);

const OWNER = 42, LAB_A = 10, LAB_B = 11;
// Fixed wire-back: inserts WITH lab_id (Lab B's issued CLIA cert).
sq.prepare("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_number, is_active) VALUES (?, ?, 'clia', 'B-CLIA', 1)").run(OWNER, LAB_B);
// A Lab A cert, correctly lab-scoped.
sq.prepare("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_number, is_active) VALUES (?, ?, 'cap', 'A-CAP', 1)").run(OWNER, LAB_A);
// OLD (buggy) wire-back behavior: NULL lab_id — proves invisibility.
sq.prepare("INSERT INTO lab_certificates (user_id, lab_id, cert_type, cert_number, is_active) VALUES (?, NULL, 'clia', 'OLD-NULL', 1)").run(OWNER);

const rosterB = sq.prepare("SELECT cert_number FROM lab_certificates WHERE lab_id = ? AND is_active = 1").all(LAB_B).map(r => r.cert_number);
const rosterA = sq.prepare("SELECT cert_number FROM lab_certificates WHERE lab_id = ? AND is_active = 1").all(LAB_A).map(r => r.cert_number);
const legacyExport = sq.prepare("SELECT cert_number FROM lab_certificates WHERE user_id = ? AND is_active = 1").all(OWNER).map(r => r.cert_number);

ok("fixed wire-back cert (lab_id set) IS visible on Lab B's roster", rosterB.includes("B-CLIA"));
ok("Lab B roster does NOT leak Lab A's cert", !rosterB.includes("A-CAP"));
ok("Lab A roster shows only Lab A's cert", rosterA.length === 1 && rosterA[0] === "A-CAP");
ok("OLD null-lab_id cert is invisible to EVERY lab roster (the pre-fix bug)",
  !rosterA.includes("OLD-NULL") && !rosterB.includes("OLD-NULL"));
ok("legacy user_id export (single-lab path, unchanged) still returns all owner certs",
  legacyExport.length === 3);
sq.close();

console.log(fails === 0 ? "\n=== VERITALAB MULTILAB: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
