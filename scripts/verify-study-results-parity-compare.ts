// scripts/verify-study-results-parity-compare.ts
//
// Step 2 of scripts/verify-study-results-parity.mjs: for every study the browser posted, compute the results on the
// server (studyRowToClient + computeStudyResults, exactly what the export-all job uses) and require JSON identical to
// what the browser sent with Download PDF.
// Run: tsx --tsconfig tsconfig.json scripts/verify-study-results-parity-compare.ts <OUT>/browser-results.json
import fs from "node:fs";
import Database from "better-sqlite3";
import { studyRowToClient } from "../server/studyPdf";
import { computeStudyResults } from "../client/src/lib/studyResults";

const file = process.argv[2];
const { scratchDb, studies } = JSON.parse(fs.readFileSync(file, "utf-8"));
const db = new Database(scratchDb, { readonly: true });
let failures = 0;
for (const [id, s] of Object.entries<any>(studies)) {
  const row = db.prepare("SELECT * FROM studies WHERE id = ?").get(Number(id));
  const server = JSON.stringify(computeStudyResults(studyRowToClient(row)));
  const browser = JSON.stringify(s.results);
  const same = server === browser;
  if (!same) failures++;
  console.log(`${same ? "PASS" : "FAIL"}  4. ${s.type} (study ${id}, from production study ${s.sourceId}): server results identical to the browser's  :: ${server.length} chars`);
}
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
