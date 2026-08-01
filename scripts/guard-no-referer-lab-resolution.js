#!/usr/bin/env node
/**
 * guard-no-referer-lab-resolution.js
 *
 * CI guard requested 2026-07-31 after the cross-lab data-bleed incident, whose
 * root cause was lab context being resolved from the Referer header. Lab
 * resolution was unified through activeLabIdFromContext(req) in
 * server/routes.ts, whose precedence is:
 *     path scope  >  explicit ?labId  >  X-Active-Lab-Id header  >  Referer
 * The Referer is the LOWEST-precedence, last-resort fallback and lives in
 * exactly ONE place. This guard fails the build if any NEW code reads the
 * Referer/Referrer request header anywhere else, so a future endpoint cannot
 * quietly reintroduce Referer-based lab scoping (which leaks another lab's data
 * when a multi-lab user navigates between labs).
 *
 * It scans server/ *.ts, ignores comments, and flags any Referer header read
 * except the single allowlisted line inside activeLabIdFromContext. Exits 1 on
 * any violation.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_DIR = path.join(__dirname, "..", "server");

// A read of the Referer/Referrer REQUEST header (not the word in a comment).
const READ_PATTERNS = [
  /headers\s*\.\s*referr?er\b/i,        // req.headers.referer
  /headers\s*\?\.\s*referr?er\b/i,      // req?.headers?.referer
  /headers\s*[?]?\.\s*\[\s*["']referr?er["']\s*\]/i, // headers["referer"] / headers?.["referer"]
  /headers\s*\[\s*["']referr?er["']\s*\]/i,          // headers['referer']
  /\.get\(\s*["']referr?er["']/i,       // req.get("referer")
  /\.header\(\s*["']referr?er["']/i,    // req.header("referer")
];

// The ONLY sanctioned Referer read: the last-resort fallback inside
// activeLabIdFromContext (server/routes.ts). Compared against the trimmed line.
const ALLOWLIST = new Set([
  "const ref = req?.headers?.referer;",
]);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

function isCommentLine(trimmed) {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

const offenders = [];
let allowlistHits = 0;

for (const file of walk(SERVER_DIR)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || isCommentLine(trimmed)) return;
    if (!READ_PATTERNS.some((re) => re.test(line))) return;
    if (ALLOWLIST.has(trimmed)) { allowlistHits++; return; }
    offenders.push({ file: path.relative(path.join(__dirname, ".."), file), line: idx + 1, text: trimmed });
  });
}

if (offenders.length > 0) {
  console.error("FAIL: Referer-based request-header read outside activeLabIdFromContext.\n");
  console.error("Lab context must resolve via scope / ?labId / X-Active-Lab-Id, never Referer.");
  console.error("If a new low-precedence fallback is genuinely required, route it through");
  console.error("activeLabIdFromContext in server/routes.ts and add it to this guard's ALLOWLIST.\n");
  for (const o of offenders) console.error(`  ${o.file}:${o.line}  ${o.text}`);
  process.exit(1);
}

if (allowlistHits === 0) {
  console.error("FAIL: the sanctioned Referer read was not found. If activeLabIdFromContext");
  console.error("was refactored, update this guard's ALLOWLIST to match the new line, or the");
  console.error("guard is silently watching nothing.");
  process.exit(1);
}

console.log(`PASS: no Referer-based lab resolution outside activeLabIdFromContext (${allowlistHits} allowlisted read).`);
