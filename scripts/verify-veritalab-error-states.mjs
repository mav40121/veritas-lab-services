// scripts/verify-veritalab-error-states.mjs
//
// Receipt for the VeritaLab client error-state fixes (audit #2 HIGH + #4 MED,
// 2026-07-10), both in client/src/pages/VeritaLabAppPage.tsx.
//
//   #2 HIGH: loadCertificates only set state on res.ok and swallowed failures,
//   so a failed cert-list fetch rendered the "No certificates yet" empty state.
//   A director with certs saw "none" on a transient error and could re-add
//   duplicates. Fix: throw on !res.ok, set a distinct certsError, render a
//   dedicated error card (with Retry) BEFORE the empty state, and gate the
//   empty state on !certsError.
//
//   #4 MED: openDocuments never cleared documents before fetching, so on a
//   failed load the PREVIOUS cert's documents rendered under the newly-opened
//   cert and Download/Delete acted on the wrong doc IDs. Fix: setDocuments([])
//   + setDocError(false) up front, throw on !res.ok, render a doc-modal error
//   branch.
//
//   node scripts/verify-veritalab-error-states.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaLabAppPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #2 cert-list error state
ok("#2 declares certsError state", /const \[certsError, setCertsError\] = useState\(false\);/.test(src));
ok("#2 loadCertificates throws on !res.ok (no silent swallow)",
  /async function loadCertificates\(\)[\s\S]*?if \(!res\.ok\) throw new Error/.test(src));
ok("#2 loadCertificates sets certsError=true in catch",
  /async function loadCertificates\(\)[\s\S]*?catch \(err\) \{[\s\S]*?setCertsError\(true\);/.test(src));
ok("#2 renders a distinct error card before the empty state",
  /certsError &&[\s\S]*?Couldn't load certificates/.test(src));
ok("#2 error card has a Retry that re-runs loadCertificates",
  /onClick=\{\(\) => \{ setLoading\(true\); loadCertificates\(\); \}\}/.test(src));
ok("#2 empty state is now gated on !certsError (won't co-render with the error)",
  /!loading && !certsError && certificates\.length === 0/.test(src));

// #4 documents modal reset + error
ok("#4 declares docError state", /const \[docError, setDocError\] = useState\(false\);/.test(src));
ok("#4 openDocuments clears documents up front (setDocuments([]))",
  /async function openDocuments\(certId: number\)[\s\S]*?setDocuments\(\[\]\);[\s\S]*?setDocError\(false\);/.test(src));
ok("#4 openDocuments throws on !res.ok and sets docError",
  /async function openDocuments\(certId: number\)[\s\S]*?if \(!res\.ok\) throw new Error[\s\S]*?catch \(err\) \{[\s\S]*?setDocError\(true\);/.test(src));
ok("#4 doc modal renders a docError branch",
  /docError \?[\s\S]*?Couldn't load documents for this certificate/.test(src));

console.log(fails === 0 ? "\n=== VERITALAB ERROR STATES: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
