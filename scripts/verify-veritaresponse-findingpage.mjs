// scripts/verify-veritaresponse-findingpage.mjs
//
// Receipt for the VeritaResponse finding-detail (VeritaResponseFindingPage)
// failure-handling + UX batch, 2026-07-12:
//   #4 (MED) a 500 on the finding load rendered "may have been deleted / no
//      access". Now distinguishes 404/403 (not-found) from 5xx (a distinct
//      "Couldn't load this finding" card with Retry).
//   #7 (MED) the fetch effect ignored the active lab. Now depends on activeLabId.
//   #8 (MED) a failed detail DELETE navigated away as if it worked. Now checks
//      res.ok, toasts, and only navigates on success.
//   #9 (MED) effectiveness checkpoints used a native window.prompt + alert (which
//      are suppressed in sandboxed iframes) and swallowed load errors. Replaced
//      with a styled dialog + toast, and a distinct checks-load error state.
//   #13 (MED) an "Other"/legacy-unflagged accreditor finding showed no PDF card
//      and no explanation. Now renders a "Response document" note.
//
//   node scripts/verify-veritaresponse-findingpage.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "client/src/pages/VeritaResponseFindingPage.tsx"), "utf8");
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? "PASS" : "FAIL"}: ${label}`); if (!cond) fails++; };

ok("imports useToast", /import \{ useToast \} from "@\/hooks\/use-toast"/.test(src));
ok("imports Dialog primitives", /import \{\s*Dialog,\s*DialogContent,\s*DialogHeader,\s*DialogTitle,\s*DialogFooter,\s*\} from "@\/components\/ui\/dialog"/.test(src));

// #4 error-vs-notfound
ok("#4 fetchFinding branches 404/403 vs 5xx", /if \(res\.status === 404 \|\| res\.status === 403\) \{ setFinding\(null\); setLoadError\(false\); \}\s*\n\s*else setLoadError\(true\);/.test(src));
ok("#4 renders a distinct load-error card with Retry", /Couldn't load this finding[\s\S]*?onClick=\{fetchFinding\}/.test(src));
ok("#4 declares loadError state", /const \[loadError, setLoadError\] = useState\(false\)/.test(src));

// #7 lab-switch
ok("#7 finding fetch effect depends on activeLabId", /\}, \[hasPlanAccess, id, activeLabId\]\);/.test(src));

// #8 delete
ok("#8 handleDelete checks res.ok and only navigates on success",
  /if \(!res\.ok\) \{[\s\S]*?Could not delete finding[\s\S]*?return;[\s\S]*?\}\s*\} catch \{[\s\S]*?return;\s*\}\s*navigate\(/.test(src));

// #9 checkpoints: no native prompt/alert; dialog + toast + checksError
ok("#9 no window.prompt( call remains", !/window\.prompt\(/.test(src));
ok("#9 no alert( call remains", !/(?<!\/\/[^\n]*)\balert\(/.test(src));
ok("#9 uses openRecord + submitRecord (dialog flow)", /const openRecord =/.test(src) && /const submitRecord = async/.test(src));
ok("#9 declares checksError state", /const \[checksError, setChecksError\] = useState\(false\)/.test(src));
ok("#9 checks load throws on !r.ok and flags checksError", /if \(!r\.ok\) throw new Error\(`load \$\{r\.status\}`\)[\s\S]*?catch \{[\s\S]*?setChecksError\(true\)/.test(src));
ok("#9 renders a checks error-with-retry state", /Couldn't load the checkpoints\.[\s\S]*?onClick=\{load\}/.test(src));
ok("#9 record dialog is present", /<Dialog open=\{!!recordTarget\}/.test(src));

// #13 fallback card
ok("#13 fallback card gates on hasCard (CMS or lab-allowed CAP/TJC/COLA/AABB)",
  /const hasCard =\s*acc === "CMS" \|\|\s*\(\["CAP", "TJC", "COLA", "AABB"\]\.includes\(acc\) && labAllowedAccreditors\.has\(acc\)\)/.test(src));
ok("#13 fallback explains the Other case", /has no standardized Plan of Correction form/.test(src));
ok("#13 fallback explains the legacy-flag case", /not currently flagged for \$\{acc\} accreditation/.test(src));

// no em-dash in added user-facing copy
const added = [
  (src.match(/Couldn't load this finding[\s\S]*?try again\./) || [""])[0],
  (src.match(/has no standardized Plan of Correction form[\s\S]*?findings\./) || [""])[0],
].join("");
ok("added copy has no em-dash", !added.includes("—") && !added.includes("\\u2014"));

console.log(fails === 0 ? "\n=== VERITARESPONSE FINDING PAGE: PASS ===" : `\n=== ${fails} FAIL ===`);
process.exit(fails === 0 ? 0 : 1);
