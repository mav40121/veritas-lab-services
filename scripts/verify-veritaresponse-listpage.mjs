// scripts/verify-veritaresponse-listpage.mjs
//
// Receipt for the VeritaResponse list-page (VeritaResponseAppPage) read/write
// failure-handling batch, 2026-07-12:
//   #2 (HIGH) a failed findings load rendered "No findings yet" (0 Overdue tiles),
//      hiding a 500/403 as an empty board. Now flags loadError and renders a
//      distinct error card with Retry, gating the empty state on !loadError.
//   #3 (HIGH) a failed create POST cleared+closed the dialog exactly like success.
//      Now checks res.ok, keeps the dialog open, and toasts the server error.
//   #8 (MED)  a failed list delete refetched silently as if it worked. Now checks
//      res.ok and toasts on failure.
//   #7 (MED)  the fetch effect ignored the active lab, so the list went stale
//      after a lab switch. Now depends on activeLabId.
//
//   node scripts/verify-veritaresponse-listpage.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaResponseAppPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("imports useToast", /import \{ useToast \} from "@\/hooks\/use-toast"/.test(src));
ok("declares a loadError state", /const \[loadError, setLoadError\] = useState\(false\)/.test(src));

// #2 list read: throw on !res.ok and flag the error (no silent empty)
ok("#2 fetchData throws on !res.ok", /if \(!res\.ok\) throw new Error\(`Failed to load findings/.test(src));
ok("#2 fetchData sets loadError on failure", /setLoadError\(true\)/.test(src));
ok("#2 fetchData clears loadError on success", /setLoadError\(false\)/.test(src));
ok("#2 renders a distinct error card", /Couldn't load your findings/.test(src));
ok("#2 error card has a Retry that re-fetches", /onClick=\{fetchData\}>\s*<RefreshCw/.test(src));
ok("#2 empty state is gated on !loadError",
  /\{!loadError && findings\.length === 0 && \(/.test(src));
ok("#2 error row is gated on loadError && empty",
  /\{loadError && findings\.length === 0 && \(/.test(src));

// #3 create: res.ok guard, keep dialog open, toast, no unconditional clear
ok("#3 handleCreate checks res.ok before treating as success",
  /const res = await fetch\(`\$\{findingsApi\}`, \{\s*method: "POST"[\s\S]*?if \(!res\.ok\) \{/.test(src));
ok("#3 handleCreate toasts the server error and returns on failure",
  /Could not create finding[\s\S]*?return;/.test(src));

// #8 delete: res.ok guard + toast
ok("#8 handleDelete checks res.ok", /const res = await fetch\(`\$\{findingsApi\}\/\$\{id\}`, \{\s*method: "DELETE"[\s\S]*?if \(!res\.ok\) \{/.test(src));
ok("#8 handleDelete toasts on failure", /Could not delete finding/.test(src));

// #7 lab-switch staleness: effect depends on activeLabId
ok("#7 fetch effect depends on activeLabId",
  /\}, \[hasPlanAccess, activeLabId\]\);/.test(src));

// No em-dash regressions in the file's user-facing strings we added.
const added = (src.match(/Couldn't load your findings[\s\S]*?try again\./) || [""])[0];
ok("added error copy has no em-dash", !added.includes("—") && !added.includes("\\u2014"));

console.log(fails === 0 ? "\n=== VERITARESPONSE LIST PAGE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
