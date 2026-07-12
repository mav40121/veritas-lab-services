// scripts/verify-veritatrack-error-states.mjs
//
// Receipt for the VeritaTrack error-as-empty fix (audit #2 HIGH, 2026-07-11).
// The tasks query did `if (!r.ok) return []`, so a failed load resolved to an
// empty list, rendered the "No tasks yet" empty state, and auto-opened Quick
// Setup -> a director on a transient outage saw an empty calendar and was nudged
// to re-seed (creating duplicates). Now the tasks + dashboard queries throw on
// !r.ok, the empty state is gated on !tasksError, a distinct error card (with
// Retry) renders on failure, and the auto-open effect is gated on !tasksError.
//
//   node scripts/verify-veritatrack-error-states.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaTrackAppPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("tasks query throws on !r.ok (no silent return [])",
  /queryKey: \[tasksKey\][\s\S]*?if \(!r\.ok\) throw new Error/.test(src) && !/if \(!r\.ok\) return \[\];/.test(src));
ok("tasks query exposes isError (tasksError)", /isError: tasksError/.test(src));
ok("dashboard query also throws on !r.ok", /queryKey: \[dashKey\][\s\S]*?if \(!r\.ok\) throw new Error/.test(src));
ok("a distinct error card renders on tasksError, before the empty state",
  /tasksError &&[\s\S]*?Couldn't load your calendar/.test(src));
ok("the error card has a Retry that re-runs refetch",
  /Couldn't load your calendar[\s\S]*?onClick=\{\(\) => refetch\(\)\}/.test(src));
ok("the empty state is gated on !tasksError (won't co-render with the error)",
  /!isLoading && !tasksError && tasks\.length === 0/.test(src));
ok("the auto-open Quick Setup effect is gated on !tasksError",
  /if \(!isLoading && !tasksError && tasks\.length === 0\)/.test(src));

console.log(fails === 0 ? "\n=== VERITATRACK ERROR STATES: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
