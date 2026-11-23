// scripts/verify-veritapolicy-master-notes.mjs
//
// BUG-182 (2026-11-23): the VeritaDC Master List (server/veritapolicyMasterList.ts) shows each policy's Notes in the
// in-app tracker and in the Master List Excel download. 18 of its 58 rows carried a note written for a different
// policy (antimicrobial stewardship on Manual Hematology QC, an onboarding checklist on Microbiology Isolation and
// Identification, radiobioassay on Parasitology, and so on), present since the list was first imported (PR #33,
// 2026-05-03). This check fails when a note names a topic that the row's own name, description and subspecialty
// don't cover: each TOPIC pairs words a note can use with words its row must then contain. It also self-tests that
// the BUG-182 pairs are caught and a matching pair passes.
// Run: node scripts/verify-veritapolicy-master-notes.mjs [path to veritapolicyMasterList.ts]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] || join(ROOT, "server", "veritapolicyMasterList.ts");

// [topic, the note mentions it, the row must then mention one of these]
const TOPICS = [
  ["antibiogram / stewardship", /antibiogram|stewardship/i, /susceptib|antimicrob|microbiolog/i],
  ["manual differential / slide review", /\bdifferential\b|slide review|body fluid/i, /hematolog|differential|body fluid/i],
  ["histology", /\bhistology\b|embedding-to-slide/i, /histolog|histopath|anatomic|surgical|mohs|tissue/i],
  ["cytology", /cytolog|cytotech|gyn rescreen/i, /cytolog/i],
  ["cytogenetics", /cytogenetic|\bFISH\b/i, /cytogenetic|genetic/i],
  ["HLA / transplant crossmatch", /\bHLA\b|\bASHI\b|HSC transplant/i, /\bHLA\b|histocompat|transplant|donor|compatib|crossmatch/i],
  ["radiation / radiobioassay", /radiobioassay|\bNRC\b|\bALARA\b|radiation safety officer|dosimetry/i, /radi/i],
  ["onboarding", /onboarding|pre-independent-testing/i, /orientation|onboard|training|competenc|personnel/i],
  ["job descriptions", /job description/i, /personnel|qualification|organiz|governance|orientation|\bjob\b/i],
  ["continuing education", /continuing education|\bCME\b/i, /education|training|competenc|personnel|qualification/i],
  ["document control", /document control|version history/i, /document|procedure|record/i],
  ["risk assessment", /risk assessment|risk register/i, /risk|IQCP|individualized quality control/i],
  ["quality indicators", /indicator dashboard|trended data/i, /quality|improvement|indicator/i],
  ["access control", /access list|role-based|\bMFA\b|password/i, /security|access|privacy|cyber/i],
  ["bloodborne pathogens / PPE", /bloodborne|exposure control plan|\bPPE\b/i, /infection|precaution|bloodborne|\bPPE\b|pathogen/i],
  ["reference lab selection", /reference lab list|criteria used to select|reference lab evaluation/i, /reference lab/i],
  ["method performance", /method evaluation|calibration verification|reportable range/i, /calibrat|method|performance spec/i],
  ["donor / transplant program", /hematopoietic|solid organ|transplant program/i, /donor|transplant|donation|\bHLA\b|histocompat|tissue|\bcell\b/i],
  ["microbiology culture", /culture workup|microbiology procedure manual/i, /microbiolog|culture|bacteriolog/i],
  ["coagulation", /coagulation|PT\/INR|APTT/i, /coag/i],
  ["parasitology", /ova and parasite|parasit/i, /parasit|microbiolog/i],
  ["virology", /virolog|\bviral\b/i, /virolog|\bviral\b|microbiolog|molecular/i],
];

function problems(row) {
  const own = `${row.policy_name} ${row.description} ${row.subspecialty}`;
  return TOPICS.filter(([, inNote, inRow]) => inNote.test(row.notes) && !inRow.test(own)).map(([t]) => t);
}

const str = (block, key) => {
  const m = new RegExp(`"${key}":\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(block);
  return m ? JSON.parse(`"${m[1]}"`) : "";
};
const src = readFileSync(file, "utf8");
const rows = [...src.matchAll(/\{[^{}]*"policy_id"[^{}]*\}/g)].map((m) => ({
  policy_id: str(m[0], "policy_id"), policy_name: str(m[0], "policy_name"), description: str(m[0], "description"),
  subspecialty: str(m[0], "subspecialty"), notes: str(m[0], "notes"),
}));

let fails = 0;
for (const r of rows) {
  const p = problems(r);
  if (p.length) { fails++; console.log(`FAIL  policy ${r.policy_id} ${r.policy_name} | note is about: ${p.join(", ")} | "${r.notes.slice(0, 80)}"`); }
}

// Self-test: two of the BUG-182 pairs must be caught, and the same notes on their own policies must pass.
const bad1 = { policy_name: "Manual Hematology QC Policy", subspecialty: "Hematology", description: "Quality control for manual hematology procedures.", notes: "Antimicrobial stewardship support: antibiogram production cadence and reporting cascades." };
const bad2 = { policy_name: "Parasitology Testing Procedures Policy", subspecialty: "Microbiology", description: "How the laboratory performs parasitology testing.", notes: "Radiobioassay program: NRC license requirements where applicable." };
const good = { policy_name: "Microbiology Isolation and Identification Policy", subspecialty: "Microbiology", description: "Isolation, identification and antimicrobial susceptibility testing.", notes: bad1.notes };
const bites = problems(bad1).length > 0 && problems(bad2).length > 0 && problems(good).length === 0;
console.log(`${bites ? "PASS" : "FAIL"}  self-test: stewardship on Manual Hematology QC and radiobioassay on Parasitology are caught; stewardship on Microbiology passes`);
console.log(`${rows.length - fails} of ${rows.length} master-list notes are about their own policy (${file.replace(/\\/g, "/").split("/").slice(-2).join("/")}).`);
const ok = fails === 0 && bites && rows.length > 0;
console.log(ok ? "ALL PASS" : `${fails + (bites ? 0 : 1) + (rows.length ? 0 : 1)} FAILURE(S)`);
process.exit(ok ? 0 : 1);
