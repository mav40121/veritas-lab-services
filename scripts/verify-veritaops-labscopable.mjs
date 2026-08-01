#!/usr/bin/env node
// Gate-3 receipt for the VeritaOps lab-switch scoping fix (audit MED #1).
// The lab switcher only rewrites the URL to /labs/:labId/<path> when <path>
// is in LAB_SCOPABLE_PATHS. VeritaOps HAS a lab-scoped route in App.tsx but
// was missing from that list, so a lab switch on VeritaOps didn't re-scope
// the URL like every other module. Assert the sync is now correct.
//
// Usage: node scripts/verify-veritaops-labscopable.mjs
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hook = readFileSync(resolve(root, "client/src/hooks/useActiveLabId.ts"), "utf8");
const app = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log(`  PASS  ${name}`); } else { fail++; console.log(`  FAIL  ${name}`); } };

// The lab-scoped route exists in App.tsx (the reason the omission was a bug).
ok("App.tsx defines the lab-scoped route /labs/:labId/veritaops-app",
   /path=["']\/labs\/:labId\/veritaops-app["']/.test(app));

// LAB_SCOPABLE_PATHS now contains /veritaops-app.
const listMatch = hook.match(/LAB_SCOPABLE_PATHS[^=]*=\s*\[([\s\S]*?)\]/);
ok("LAB_SCOPABLE_PATHS block found in useActiveLabId.ts", !!listMatch);
const list = listMatch ? listMatch[1] : "";
ok("LAB_SCOPABLE_PATHS includes \"/veritaops-app\"", /["']\/veritaops-app["']/.test(list));

// Regression guard: every module -app route that is lab-scoped in App.tsx
// should be present in LAB_SCOPABLE_PATHS. Check the VeritaOps case plus a
// couple of known-good siblings so this receipt also proves the invariant
// wasn't already broken elsewhere for these.
for (const p of ["/veritaops-app", "/veritamap-app", "/veritaqc-app"]) {
  const scopedRoute = new RegExp(`path=["']/labs/:labId${p}["']`).test(app);
  const inList = new RegExp(`["']${p}["']`).test(list);
  ok(`sync: ${p} is lab-scoped in App.tsx (${scopedRoute}) AND in LAB_SCOPABLE_PATHS (${inList})`,
     !scopedRoute || inList);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
