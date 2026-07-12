// scripts/verify-veritaresponse-pdf-identity-footer.mjs
//
// Receipt for VeritaResponse audit #1 (HIGH, PDF lab identity) + #5 (MED, PDF footer),
// 2026-07-12.
//
//   #1  All 5 accreditor POC builders (CMS-2567/CAP/TJC/COLA/AABB) read
//       input.user.lab_name / .clia_number, but the routes fed them
//       storage.getUserById(dataUserId) -- a Drizzle TYPED select over the users
//       schema object, which declares NEITHER column (they live on the labs
//       table), so every rendered Plan of Correction printed the logged-in
//       PERSON's name and always "CLIA: Not on file". Fixed by resolving the
//       FINDING's lab identity (labs row, with a raw users fallback) via a new
//       resolveFindingLabIdentity helper.
//   #5  All 5 generators passed "" as the running-footer template, so a
//       multi-page POC had no brand line and no "Page X of Y". Fixed with a
//       VERITARESPONSE_FOOTER_TEMPLATE, mirroring the VeritaPolicy fix.
//
//   node scripts/verify-veritaresponse-pdf-identity-footer.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const routes = fs.readFileSync(path.join(ROOT, "server/routes.ts"), "utf8");
const pdf = fs.readFileSync(path.join(ROOT, "server/pdfReport.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

console.log("=== #1 identity: source proofs ===");
ok("#1 resolveFindingLabIdentity helper is defined",
  /function resolveFindingLabIdentity\(\s*finding: any,\s*ownerUserId: number,?\s*\)/.test(routes));
ok("#1 helper resolves the FINDING's lab from the labs table",
  /SELECT lab_name, clia_number FROM labs WHERE id = \?/.test(routes));
ok("#1 helper falls back to a RAW users read (clia_lab_name present, unlike the typed select)",
  /SELECT clia_lab_name, clia_number FROM users WHERE id = \?/.test(routes));
ok("#1 all 5 PDF routes now call resolveFindingLabIdentity(finding, dataUserId)",
  (routes.match(/const user = resolveFindingLabIdentity\(finding, dataUserId\)/g) || []).length === 5);
ok("#1 no PDF route still uses the typed getUserById for identity",
  !/const user = await storage\.getUserById\(dataUserId\);/.test(routes));

console.log("\n=== #5 footer: source proofs ===");
ok("#5 VERITARESPONSE_FOOTER_TEMPLATE is defined",
  /const VERITARESPONSE_FOOTER_TEMPLATE = `/.test(pdf));
ok("#5 footer carries the brand line",
  /VeritaAssure&trade; \| VeritaResponse&trade; \| Confidential - For Internal Lab Use Only/.test(pdf));
ok("#5 footer carries Page X of Y",
  /Page <span class="pageNumber"><\/span> of <span class="totalPages"><\/span>/.test(pdf));
// The footer template block must not contain an em-dash (Sec 3 / Sec 6.6).
const tplBlock = (pdf.match(/const VERITARESPONSE_FOOTER_TEMPLATE = `[\s\S]*?`;/) || [""])[0];
ok("#5 footer template contains NO em-dash (char or \\u2014 escape)",
  tplBlock.length > 0 && !tplBlock.includes("—") && !tplBlock.includes("\\u2014"));
ok("#5 all 5 VeritaResponse generators now pass VERITARESPONSE_FOOTER_TEMPLATE",
  (pdf.match(/applyLicenseToPuppeteer\(html, VERITARESPONSE_FOOTER_TEMPLATE, licenseCtx\)/g) || []).length === 5);
// The 5 VeritaResponse builders must no longer pass "" -- but the CMS-209 federal
// replica (one deliberate empty-footer call) must remain untouched.
const emptyFooterCalls = (pdf.match(/applyLicenseToPuppeteer\(html, "", licenseCtx\)/g) || []).length;
ok("#5 exactly ONE empty-footer call remains (the deliberate CMS-209 federal-form replica)",
  emptyFooterCalls === 1);

console.log("\n=== #1 functional proof: the exact SQL the helper runs, on a fixture DB ===");
const db = new Database(":memory:");
db.exec(`
  CREATE TABLE labs (id INTEGER PRIMARY KEY, lab_name TEXT, clia_number TEXT);
  CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT, name TEXT, plan TEXT,
                      clia_lab_name TEXT, clia_number TEXT);
  INSERT INTO labs (id, lab_name, clia_number) VALUES (5, 'Riverside Regional Medical Center', '22D0999999');
  INSERT INTO users (id, email, name, plan, clia_lab_name, clia_number)
    VALUES (3, 'director@example.com', 'Michael Veri', 'hospital', 'Michaels Lab', '11D2222222');
`);

// Replicate resolveFindingLabIdentity exactly.
function resolve(finding, ownerUserId) {
  if (finding?.lab_id) {
    const lab = db.prepare("SELECT lab_name, clia_number FROM labs WHERE id = ?").get(finding.lab_id);
    if (lab && (lab.lab_name || lab.clia_number)) {
      return { lab_name: lab.lab_name ?? null, clia_number: lab.clia_number ?? null };
    }
  }
  const u = db.prepare("SELECT clia_lab_name, clia_number FROM users WHERE id = ?").get(ownerUserId);
  return { lab_name: u?.clia_lab_name ?? null, clia_number: u?.clia_number ?? null };
}

// FIXED behaviour: a finding on lab 5 stamps the LAB's name + CLIA (multi-lab correct).
const onLab = resolve({ lab_id: 5 }, 3);
ok("#1 finding on lab 5 -> lab_name = 'Riverside Regional Medical Center'",
  onLab.lab_name === "Riverside Regional Medical Center");
ok("#1 finding on lab 5 -> clia_number = '22D0999999' (NOT 'Not on file')",
  onLab.clia_number === "22D0999999");

// Legacy null-lab_id finding falls back to the owner's users record (raw read).
const legacy = resolve({ lab_id: null }, 3);
ok("#1 legacy null-lab finding -> falls back to users.clia_lab_name = 'Michaels Lab'",
  legacy.lab_name === "Michaels Lab");
ok("#1 legacy null-lab finding -> users.clia_number = '11D2222222'",
  legacy.clia_number === "11D2222222");

// OLD BUG reproduction: a Drizzle TYPED select over the users schema returns only
// declared columns (id/email/name/plan) -- NO clia_lab_name/clia_number -- so the
// builder's `user.lab_name || user.name` fell through to the PERSON's name and clia
// fell to the fallback string. Prove the typed row lacks the identity columns.
const typedRow = db.prepare("SELECT id, email, name, plan FROM users WHERE id = ?").get(3);
ok("#1 (old bug) typed getUserById-style row has NO clia_number key -> would print 'Not on file'",
  typedRow.clia_number === undefined);
ok("#1 (old bug) typed row has NO lab_name key -> builder fell through to user.name ('Michael Veri')",
  typedRow.lab_name === undefined && typedRow.name === "Michael Veri");

db.close();
console.log(fails === 0 ? "\n=== VERITARESPONSE PDF IDENTITY + FOOTER: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
