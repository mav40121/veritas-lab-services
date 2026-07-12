// scripts/verify-veritatrack-hygiene.mjs
//
// Receipt for the VeritaTrack server hygiene batch (audit #12 + #9, 2026-07-11):
//   #12 three customer-facing Excel About paragraphs contained em-dashes (a
//       CLAUDE.md Sec 3 / Sec 6.6 NON-NEGOTIABLE breach). Replaced with a
//       colon, a period, and commas; the "does not validate" nuance became
//       "does not confirm" (verify-not-validate house style).
//   #9  the legacy (unscoped) dashboard endpoint scoped by user_id, so a
//       multi-lab owner's summary counts aggregated across every lab they own
//       instead of matching the lab-scoped /tasks list. Now scoped by lab_id
//       via resolveLegacyLabId, matching the /tasks read.
//
//   node scripts/verify-veritatrack-hygiene.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "server/veritatrack.ts"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #12 em-dash: none remain in any aboutBody(...) paragraph (em-dash char or — escape)
const abouts = [...src.matchAll(/aboutBody\((?:"|`)([\s\S]*?)(?:"|`)\);/g)].map(m => m[1]);
ok("#12 no aboutBody paragraph contains an em-dash (char or \\u2014 escape)",
  abouts.length > 0 && abouts.every(a => !a.includes("—") && !a.includes("\\u2014")));
ok("#12 the register sentence now uses a colon", /tracked in VeritaTrack: daily, weekly/.test(src));
ok("#12 the disclaimer now says 'does not confirm' (verify-not-validate)", /in VeritaTrack\. It does not confirm that the work/.test(src));
ok("#12 the coverage-gaps sentence uses commas, not em-dashes", /not represented here, for example multi-shift sign-off tracking/.test(src));

// #9 legacy dashboard lab-scoped
ok("#9 the legacy dashboard no longer scopes tasks by user_id",
  !/SELECT \* FROM veritatrack_tasks WHERE user_id = \? AND active = 1/.test(src));
ok("#9 the legacy dashboard now scopes by lab_id via resolveLegacyLabId",
  /#9 multi-lab fix[\s\S]*?const labId = resolveLegacyLabId\(sqlite, req\);[\s\S]*?WHERE lab_id = \? AND active = 1/.test(src));

console.log(fails === 0 ? "\n=== VERITATRACK HYGIENE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
