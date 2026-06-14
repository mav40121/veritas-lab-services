// scripts/audit-labscoped-write-routes.mjs
//
// Catches the silent-no-op class the VeritaPT AAA-write bug belonged to: the
// client fetches a lab-scoped URL (/api/labs/:labId/...) with a write method
// (POST/PUT/DELETE/PATCH), but the server has no matching route. Express then
// falls through to the SPA catch-all, which returns 200 + index.html. The
// client usually does not check the response, so the write silently does
// nothing (the form clears, the row never persists).
//
// Heuristic, not a parser. It (1) collects every server `app.METHOD("/api/...")`
// route, (2) scans client fetch() calls for lab-scoped URLs + their method,
// resolving `${someApi}` base vars, and (3) flags any lab-scoped write whose
// (method, normalized-path) has no server route. False positives are possible
// (dynamic paths, base vars it can't resolve); eyeball each. Exit 1 on any
// unallowlisted miss so it can gate CI.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SERVER_FILES = ["server/routes.ts", "server/veritacheck_verification.ts"];
const CLIENT_DIR = "client/src";

// Known false positives (path templates that are dynamic or intentionally
// non-lab-scoped at runtime). Keyed by `METHOD /api/labs/:p/<norm>`.
const ALLOWLIST = new Set([]);

const norm = (p) => p
  .split("?")[0].split("#")[0]
  .replace(/\$\{[^}]*\}/g, ":p")   // ${id} -> :p
  .replace(/:[A-Za-z_]\w*/g, ":p") // :labId -> :p
  .replace(/\/+$/, "");            // trim trailing slash

// 1. Server routes -> set of "METHOD norm(path)".
const serverRoutes = new Set();
for (const f of SERVER_FILES) {
  let src; try { src = readFileSync(f, "utf8"); } catch { continue; }
  const re = /app\.(get|post|put|delete|patch)\(\s*[`"']([^`"']+)[`"']/g;
  let m;
  while ((m = re.exec(src))) {
    const method = m[1].toUpperCase();
    const path = m[2];
    if (!path.startsWith("/api/")) continue;
    serverRoutes.add(`${method} ${norm(path)}`);
  }
}

// 2. Walk client files.
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(tsx?|jsx?)$/.test(name)) acc.push(p);
  }
  return acc;
}

const findings = [];
for (const file of walk(CLIENT_DIR)) {
  const src = readFileSync(file, "utf8");
  const lines = src.split(/\r?\n/);

  // Resolve base vars: `const X = ... /api/labs/${V}/<prefix>` (prefix up to the
  // closing quote/backtick). E.g. ptApi -> "pt".
  const baseVars = new Map();
  const baseRe = /\b([A-Za-z_]\w*)\s*=\s*[^\n;]*?\/api\/labs\/\$\{[^}]+\}\/([^`"'\s)]+)/g;
  let bm;
  while ((bm = baseRe.exec(src))) baseVars.set(bm[1], bm[2].replace(/\/+$/, ""));

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/fetch\(/.test(line)) continue;
    // Extract the first template-literal/string URL argument of fetch(.
    const urlMatch = line.match(/fetch\(\s*[`"']([^`"']+)[`"']/);
    if (!urlMatch) continue;
    let url = urlMatch[1];

    // Resolve a leading `${baseVar}/...` into its lab-scoped path.
    let labScoped = null;
    const baseUse = url.match(/^\$\{(\w+)\}\/(.*)$/);
    if (baseUse && baseVars.has(baseUse[1])) {
      labScoped = `/api/labs/:p/${baseVars.get(baseUse[1])}/${baseUse[2]}`;
    } else if (/\/api\/labs\/\$\{[^}]+\}\//.test(url)) {
      labScoped = "/api/labs/" + url.split(/\/api\/labs\//)[1];
    }
    if (!labScoped) continue;

    // Method: scan this line + next 8 for `method:`. Default GET.
    let method = "GET";
    for (let j = i; j < Math.min(lines.length, i + 9); j++) {
      const mm = lines[j].match(/method:\s*[`"'](\w+)[`"']/);
      if (mm) { method = mm[1].toUpperCase(); break; }
      if (j > i && /fetch\(/.test(lines[j])) break; // next fetch starts
    }
    if (!["POST", "PUT", "DELETE", "PATCH"].includes(method)) continue;

    const key = `${method} ${norm(labScoped)}`;
    if (serverRoutes.has(key) || ALLOWLIST.has(key)) continue;
    findings.push({ file, line: i + 1, key, url });
  }
}

console.log(`server lab-scoped routes indexed: ${[...serverRoutes].filter(r => r.includes("/api/labs/")).length}`);
console.log(`client lab-scoped writes checked across ${walk(CLIENT_DIR).length} files\n`);

if (!findings.length) {
  console.log("PASS: every client lab-scoped write has a matching server route.");
  process.exit(0);
}
console.log(`FAIL: ${findings.length} lab-scoped client write(s) with NO matching server route (silent SPA-fallback no-op):\n`);
for (const f of findings) {
  console.log(`  ${f.file}:${f.line}`);
  console.log(`     ${f.key}      (from \`${f.url}\`)`);
}
process.exit(1);
