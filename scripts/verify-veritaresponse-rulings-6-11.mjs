// scripts/verify-veritaresponse-rulings-6-11.mjs
//
// Receipt for the two VeritaResponse audit items Michael ruled on, 2026-07-12:
//   #6  The CMS-2567 PDF (and the in-app POC checklist) cited "State Operations
//       Manual section 7314" -- but SOM 7314 is "Category 1 remedies", not the
//       POC. Per Michael's ruling, the specific SOM section is dropped and the
//       durable authority is cited: "42 CFR 493 and the CMS-2567 form
//       instructions" (short form "42 CFR 493" in the tight PDF column head).
//   #11 COLA and AABB carried the same hard red "Overdue / past their deadline"
//       treatment as CMS/CAP/TJC, contradicting the module's own copy (COLA is
//       consultative; AABB's 45 days is the FDA reportable-event window). Per
//       Michael's ruling, only CMS/CAP/TJC are hard deadlines; COLA/AABB get an
//       amber "target" treatment and are excluded from the overdue count/banner.
//
//   node scripts/verify-veritaresponse-rulings-6-11.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pdf = fs.readFileSync(path.join(ROOT, "server/pdfReport.ts"), "utf8");
const finding = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaResponseFindingPage.tsx"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaResponseAppPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

console.log("=== #6 citation ===");
ok("#6 no 'section 7314' anywhere in the PDF generator", !/7314/.test(pdf));
ok("#6 no 'State Operations Manual' in the PDF generator", !/State Operations Manual/.test(pdf));
ok("#6 no 'section 7314' in the in-app POC checklist", !/7314|State Operations Manual/.test(finding));
ok("#6 PDF footer cites 42 CFR 493 and the CMS-2567 form instructions",
  /required by 42 CFR &sect;493 and the CMS-2567 form instructions/.test(pdf));
ok("#6 PDF column sub-head cites 42 CFR 493",
  /\(5 POC elements per 42 CFR 493\)/.test(pdf));
ok("#6 in-app checklist cites 42 CFR 493 and the CMS-2567 form instructions",
  /5 Plan of Correction elements per 42 CFR 493 and the CMS-2567 form instructions/.test(finding));

console.log("\n=== #11 soft-clock (COLA/AABB) ===");
// AppPage
ok("#11 AppPage defines the hard-deadline set (CMS/CAP/TJC only)",
  /HARD_DEADLINE_ACCREDITORS = new Set<Accreditor>\(\["CMS", "CAP", "TJC"\]\)/.test(app));
ok("#11 AppPage excludes soft accreditors from the overdue count",
  /if \(!isHardDeadline\(f\.accreditor\)\) return false;/.test(app));
ok("#11 AppPage list shows 'past target' for soft clocks, not 'overdue'",
  /`\$\{Math\.abs\(d\)\}d past target \(\$\{f\.due_date\}\)`/.test(app));
ok("#11 AppPage soft past-due is amber, not red",
  /hard\s*\?\s*"text-red-700[^"]*"\s*:\s*"text-amber-700/.test(app));
// FindingPage
ok("#11 FindingPage distinguishes hardDeadline",
  /const hardDeadline = \["CMS", "CAP", "TJC"\]\.includes\(finding\.accreditor\)/.test(finding));
ok("#11 FindingPage adds isPastTarget (soft, amber)",
  /const isPastTarget = !hardDeadline && d !== null && d < 0 && isActive/.test(finding));
ok("#11 FindingPage isOverdue is gated on hardDeadline",
  /const isOverdue = hardDeadline && d !== null && d < 0 && isActive/.test(finding));
ok("#11 FindingPage alert labels soft clocks 'Target' / 'past target'",
  /\{hardDeadline \? "Due" : "Target"\}/.test(finding) && /`\$\{Math\.abs\(d\)\}d past target`/.test(finding));

// Functional check of the classification logic.
console.log("\n=== #11 functional classification ===");
const HARD = new Set(["CMS", "CAP", "TJC"]);
const isHard = (a) => HARD.has(a);
ok("#11 CMS is a hard deadline", isHard("CMS") === true);
ok("#11 CAP is a hard deadline", isHard("CAP") === true);
ok("#11 TJC is a hard deadline", isHard("TJC") === true);
ok("#11 COLA is a SOFT target (not counted overdue)", isHard("COLA") === false);
ok("#11 AABB is a SOFT target (not counted overdue)", isHard("AABB") === false);
ok("#11 Other is a SOFT target", isHard("Other") === false);

// No em-dash in the reworded public strings (bounded to each sentence, not the
// whole 6600-line file which has em-dashes in other modules' code/comments).
ok("no em-dash in the reworded PDF footer sentence",
  !/required by 42 CFR &sect;493 and the CMS-2567 form instructions[^.]*—/.test(pdf));
ok("no em-dash in the in-app checklist sentence",
  !/5 Plan of Correction elements per 42 CFR 493 and the CMS-2567 form instructions[^.]*—/.test(finding));

console.log(fails === 0 ? "\n=== VERITARESPONSE RULINGS #6 + #11: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
