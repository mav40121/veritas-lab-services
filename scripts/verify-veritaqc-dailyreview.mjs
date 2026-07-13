// scripts/verify-veritaqc-dailyreview.mjs
//
// Receipt for the VeritaQC Daily Review page batch (2026-07-12):
//   #2 (HIGH) a failed QC load rendered the green "all clear" empty state,
//      telling a director QC is in control when it never loaded. Now flags
//      loadError and renders a distinct error card with Retry.
//   #11 (MED) the review flagged 'missing' corrective actions with no way to
//      file one. Added a "File corrective action" action + dialog bound to the
//      offending qc_result_id + its rejection violation.
//   #12 (MED) the monthly attestation filed in one un-confirmed click. Now
//      wrapped in a ConfirmDialog that warns when the current view still has
//      unresolved missing-CA rejections.
//
//   node scripts/verify-veritaqc-dailyreview.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaQCDailyReviewPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("imports ConfirmDialog", /import \{ ConfirmDialog \} from "@\/components\/ConfirmDialog"/.test(src));
ok("imports Dialog primitives", /import \{\s*Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,\s*\} from "@\/components\/ui\/dialog"/.test(src));

// #2 error state
ok("#2 declares loadError state", /const \[loadError, setLoadError\] = useState\(false\)/.test(src));
ok("#2 load() throws on !res.ok", /if \(!res\.ok\) throw new Error\(`Failed to load QC/.test(src));
ok("#2 load() sets loadError on failure", /setLoadError\(true\)/.test(src));
ok("#2 renders a distinct error card gated on loadError", /\) : loadError \? \(/.test(src));
ok("#2 error card says 'Couldn't load QC results' with Retry",
  /Couldn't load QC results[\s\S]*?onClick=\{load\}/.test(src));
ok("#2 error copy reassures it does NOT mean QC is in control", /does not mean QC is in control/.test(src));
ok("#2 the green all-clear empty state is now AFTER the loadError branch",
  src.indexOf(") : loadError ? (") < src.indexOf("groups.length === 0 ? ("));

// #11 file-CA action
ok("#11 declares a caTarget state", /const \[caTarget, setCaTarget\] = useState</.test(src));
ok("#11 submitCa posts to qc/corrective-actions", /const res = await fetch\(`\$\{API_BASE\}\/api\/labs\/\$\{activeLabId\}\/qc\/corrective-actions`, \{\s*method: "POST"/.test(src));
ok("#11 submitCa passes qc_result_id + qc_rule_violation_id", /qc_result_id: caTarget\.resultId,\s*qc_rule_violation_id: caTarget\.violationId,/.test(src));
ok("#11 missing-CA row has a 'File corrective action' action", /File corrective action/.test(src));
ok("#11 the action binds the rejection violation id", /const rej = r\.violations\.find\(v => v\.severity === "rejection"\);/.test(src));
ok("#11 renders a CA dialog", /<Dialog open=\{!!caTarget\}/.test(src));

// #12 attestation confirm
ok("#12 File attestation is wrapped in ConfirmDialog", /<ConfirmDialog[\s\S]*?title="File monthly attestation\?"[\s\S]*?onConfirm=\{handleFileAttestation\}/.test(src));
ok("#12 the confirm warns on unresolved missing-CA rejections", /missingCA > 0 \? ` Note: \$\{missingCA\} rejection/.test(src));

// no em-dash in added copy
ok("no em-dash in the added error/copy strings",
  !/Couldn't load QC results[\s\S]*?in control\./.test(src) || !(/Couldn't load QC results[\s\S]{0,400}—/.test(src)));

console.log(fails === 0 ? "\n=== VERITAQC DAILY REVIEW: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
