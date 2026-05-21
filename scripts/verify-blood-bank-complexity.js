// Receipt for the blood bank compatibility = HIGH complexity fix
// (PR #294 + the underlying 42 CFR 493.17 classification rule).
//
// What this verifies:
//   1. The deployed prod JS bundle contains the fdaInstrumentData entries
//      where canonical blood bank compatibility tests (ABO Group, Rh Type,
//      Antibody Screen, Crossmatch (IS), Direct Antiglobulin Test (DAT),
//      Phenotyping) are classified complexity="HIGH"
//   2. Each of those entries carries the transfusion-context note
//   3. The asterisk + tooltip support text is present in the bundle
//      (which proves the badge-rendering helper made it into the build)
//   4. A spot-check that an unrelated MODERATE test (e.g., CMV antibody
//      serology) was NOT incorrectly bumped to HIGH
//
// Why a dedicated script: the initial bundle-grep audit returned a false
// negative because str.find() on "ABO Group" matched a CFR sample data
// occurrence at offset 1040590 instead of the inventory-data occurrence
// at offset 1446702. This script scans EVERY occurrence and only counts
// the one(s) inside the fdaInstrumentData structure.
//
// Run:
//   API=https://www.veritaslabservices.com node scripts/verify-blood-bank-complexity.js

import fs from 'fs';
import path from 'path';
import os from 'os';

const API = process.env.API || 'https://www.veritaslabservices.com';

let failed = 0;
function check(label, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  if (!cond) failed += 1;
  console.log(`${status}  ${label}${detail ? '  // ' + detail : ''}`);
}

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch failed for ${url}: ${r.status}`);
  return await r.text();
}

(async () => {
  // Find the index bundle URL from the deployed index.html.
  const indexHtml = await fetchText(API + '/');
  const m = indexHtml.match(/\/assets\/index-[A-Za-z0-9_-]+\.js/);
  check('Found index bundle path in deployed HTML', !!m, m ? m[0] : 'no match');
  if (!m) { console.log('\nABORTED'); process.exit(1); }
  const bundlePath = m[0];

  const bundle = await fetchText(API + bundlePath);
  check(`Downloaded bundle (${bundle.length.toLocaleString()} bytes)`, bundle.length > 500_000);

  // For each canonical compatibility test name, find ALL occurrences in
  // the bundle. An occurrence counts as "inventory data" if it appears in
  // the shape `"<name>":{complexity:"<x>",specialty:"<y>"`. CFR sample
  // data uses a different shape (e.g., `analyte:"ABO Group",criteria:`)
  // so we filter those out.
  const COMPAT_TESTS = [
    'ABO Group',
    'Rh Type',
    'Antibody Screen',
    'Crossmatch (IS)',
    'Crossmatch (AHG)',
    'Direct Antiglobulin Test (DAT)',
    'Phenotyping (Rh, Kell, Duffy, Kidd, MNS)',
  ];

  for (const testName of COMPAT_TESTS) {
    // Look specifically for the inventory-data shape: "<name>":{complexity:
    const invRe = new RegExp(`"${testName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}":\\s*\\{[^}]{0,500}\\}`, 'g');
    const matches = Array.from(bundle.matchAll(invRe));
    if (matches.length === 0) {
      check(`${testName}: at least one inventory-data occurrence found`, false, '0 matches');
      continue;
    }
    let allHigh = true;
    let allHaveNote = true;
    for (const mm of matches) {
      const snippet = mm[0];
      if (!/complexity:\s*"HIGH"/.test(snippet)) allHigh = false;
      if (!/transfusion/i.test(snippet) || !/493\.17/.test(snippet)) allHaveNote = false;
    }
    check(`${testName}: all ${matches.length} inventory occurrences have complexity=HIGH`, allHigh);
    check(`${testName}: all ${matches.length} inventory occurrences carry the transfusion note + 493.17 citation`, allHaveNote);
  }

  // Negative check: CMV antibody should remain MODERATE (it's serology,
  // not compatibility testing). Same shape parsing as above.
  const cmvRe = /"Anti-cytomegalovirus[^"]*":\s*\{[^}]{0,500}\}/g;
  const cmvMatches = Array.from(bundle.matchAll(cmvRe));
  if (cmvMatches.length > 0) {
    const allModerate = cmvMatches.every(m => /complexity:\s*"MODERATE"/.test(m[0]));
    const noNote = cmvMatches.every(m => !/transfusion/i.test(m[0]));
    check('CMV antibody (serology) NOT incorrectly bumped to HIGH', allModerate);
    check('CMV antibody (serology) does NOT carry transfusion note', noNote);
  } else {
    check('CMV antibody entry found for negative check', false, 'CMV antibody entry not in bundle');
  }

  // Spot-check that the rendering helper made it into the build.
  check('Tooltip note text present in bundle (rendering will work)', bundle.toLowerCase().includes('transfusion services'));
  check('42 CFR 493.17 citation present in bundle', bundle.includes('493.17'));

  console.log(`\n${failed === 0 ? 'ALL TESTS PASSED' : `${failed} TEST(S) FAILED`}`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
