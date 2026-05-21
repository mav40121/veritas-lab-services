#!/usr/bin/env node
/**
 * verify-cfr-summary-pilot.js
 *
 * Receipt for the CFR plain-language summary pilot (PARKING_LOT #30).
 * Confirms the 5 pilot standards have summaries, the verbatim text is
 * still intact, and no em-dashes leaked into the summary text (CLAUDE.md
 * Section 3 forbids em-dashes in customer-facing artifacts, and these
 * summaries are intended to render in PDFs and Excel).
 *
 * Exits non-zero on any FAIL so this can drop into CI later.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'server', 'cfrRequirements.ts');
const PILOT_STANDARDS = [
  '42 CFR §493.1235',
  '42 CFR §493.1252',
  '42 CFR §493.1253',
  '42 CFR §493.1281',
  '42 CFR §493.1289',
];

function loadEntries() {
  const src = fs.readFileSync(SRC, 'utf8');
  const m = src.match(/export const CFR_REQUIREMENTS = (\[[\s\S]+\])/);
  if (!m) throw new Error('Failed to extract CFR_REQUIREMENTS array');
  const cleaned = m[1].replace(/,(\s*\])/g, '$1');
  return JSON.parse(cleaned);
}

let fails = 0;
const pass = (msg) => console.log('  PASS  ' + msg);
const fail = (msg) => { console.log('  FAIL  ' + msg); fails += 1; };

console.log('--- CFR summary pilot verification ---');
const entries = loadEntries();
console.log('Loaded ' + entries.length + ' total CFR entries.');

for (const std of PILOT_STANDARDS) {
  const matches = entries.filter((e) => e.standard === std);
  if (matches.length === 0) { fail(std + ': no entries found in cfrRequirements.ts'); continue; }
  const withSummary = matches.filter((e) => typeof e.summary === 'string' && e.summary.trim().length > 0);
  if (withSummary.length !== matches.length) {
    fail(std + ': ' + withSummary.length + '/' + matches.length + ' duplicate entries carry summary; should be all ' + matches.length);
    continue;
  }
  pass(std + ': all ' + matches.length + ' entries carry summary');

  const summaries = new Set(withSummary.map((e) => e.summary));
  if (summaries.size !== 1) {
    fail(std + ': duplicate entries have ' + summaries.size + ' distinct summary strings; should be 1');
  } else {
    pass(std + ': all duplicate entries share one summary string');
  }

  const verbatim = new Set(withSummary.map((e) => e.description));
  if (verbatim.size !== 1) {
    fail(std + ': duplicate entries no longer share the same verbatim description (' + verbatim.size + ' variants)');
  } else {
    pass(std + ': verbatim description still intact and identical across duplicates');
  }

  const sample = withSummary[0];
  if (sample.summary.length < 80) fail(std + ': summary too short (' + sample.summary.length + ' chars); likely truncated');
  else pass(std + ': summary length OK (' + sample.summary.length + ' chars)');

  if (sample.summary.includes('—')) fail(std + ': summary contains em-dash; CLAUDE.md Section 3 forbids in customer-facing copy');
  else pass(std + ': no em-dash in summary');
}

const totalWithSummary = entries.filter((e) => e.summary).length;
console.log('\nTotal entries with summary: ' + totalWithSummary + ' (pilot target: 10 = 4+3+1+1+1 across the 5 standards)');
if (totalWithSummary !== 10) fail('Total entries with summary is ' + totalWithSummary + ', expected 10');
else pass('Total entries with summary matches expected count');

if (fails > 0) {
  console.log('\n' + fails + ' check(s) FAILED');
  process.exit(1);
}
console.log('\nAll checks passed.');
