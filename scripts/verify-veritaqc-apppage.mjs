// scripts/verify-veritaqc-apppage.mjs
//
// Receipt for the VeritaQC entry page (VeritaQCAppPage) UX-hardening batch,
// 2026-07-12:
//   #3  results load error-as-empty + stale cross-lot display on a failed switch.
//   #8  control-lot load error rendered the "add your first lot" onboarding state.
//   #9  a QC result could be logged against a retired / on-hold control lot.
//   #10 expired control lots were not flagged.
//   #13 the corrective-action modal trapped the tech if the CA save kept failing.
//
//   node scripts/verify-veritaqc-apppage.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaQCAppPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

// #3 results error + clear-on-switch
ok("#3 declares resultsError state", /const \[resultsError, setResultsError\] = useState\(false\)/.test(src));
ok("#3 loadResults clears stale rows before the fetch", /setResults\(\[\]\);[\s\S]{0,120}try \{/.test(src));
ok("#3 loadResults throws on !res.ok + flags resultsError", /if \(!res\.ok\) throw new Error\(`results[\s\S]*?setResultsError\(true\)/.test(src));
ok("#3 results render has a distinct error branch with Retry", /\) : resultsError \? \([\s\S]*?Couldn't load results for this lot[\s\S]*?loadResults\(selectedLotId\)/.test(src));

// #8 lot-load error
ok("#8 declares lotsError state", /const \[lotsError, setLotsError\] = useState\(false\)/.test(src));
ok("#8 loadLots throws on !res.ok + flags lotsError", /if \(!res\.ok\) throw new Error\(`lots[\s\S]*?setLotsError\(true\)/.test(src));
ok("#8 lot render has a distinct error branch (before the empty onboarding)",
  /\) : lotsError \? \([\s\S]*?Couldn't load control lots[\s\S]*?\) : lots\.length === 0 \? \(/.test(src));

// #9 retired-lot gate
ok("#9 warns when the selected lot is not active", /selectedLot && selectedLot\.status !== "active"[\s\S]*?Select an active lot before logging QC/.test(src));
ok("#9 Submit is disabled for a non-active lot",
  /disabled=\{submitting \|\| isReadOnly \|\| \(!!selectedLot && selectedLot\.status !== "active"\)\}/.test(src));

// #10 expired-lot flag
ok("#10 renders an EXPIRED badge on a past expiration", /selectedLot\.expiration_date < todayIsoDate\(\) && \(\s*<span[\s\S]*?EXPIRED/.test(src));
ok("#10 warns before logging QC against an expired active lot", /expired on \{selectedLot\.expiration_date\}\. Confirm this is intended/.test(src));

// #13 CA-modal escape hatch
ok("#13 declares caFailCount state", /const \[caFailCount, setCaFailCount\] = useState\(0\)/.test(src));
ok("#13 CA save failure increments caFailCount", /setCaFailCount\(c => c \+ 1\)/.test(src));
ok("#13 onOpenChange allows dismissal after repeated failures", /if \(!open && caForResultId && caFailCount < 2\) return;/.test(src));
ok("#13 renders a 'Close, resolve later' escape button after 2 failures", /caFailCount >= 2 && \([\s\S]*?Close, resolve later/.test(src));
ok("#13 opening the modal resets caFailCount", /setCaFailCount\(0\);\s*\n\s*setCaModalOpen\(true\)/.test(src));

// no em-dash in added copy
const added = (src.match(/Couldn't load control lots[\s\S]*?try again\./) || [""])[0];
ok("no em-dash in the added lot-error copy", !added.includes("—") && !added.includes("\\u2014"));

console.log(fails === 0 ? "\n=== VERITAQC APP PAGE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
