// scripts/verify-client-lab-today.mjs
//
// Per-lab time zone on the pages (Michael 2026-10-26, option 1): a page's "today" is the active lab's day
// (client/src/lib/labDate.ts labTodayIso). The UTC day (new Date().toISOString() cut to 10 characters) is already
// tomorrow on a US evening, so it must not come back in client code. Fails on any such use outside labDate.ts.
// Run: node scripts/verify-client-lab-today.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "client", "src");
const rx = /new Date\(\)\.toISOString\(\)\.(slice\(0,\s*10\)|split\("T"\)\[0\]|substring\(0,\s*10\))/;
const hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name) && e.name !== "labDate.ts") {
      fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
        if (rx.test(line) && !/^\s*\/\//.test(line)) hits.push(`${path.relative(ROOT, p)}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
  }
})(ROOT);
console.log(hits.length ? `FAIL  ${hits.length} UTC "today" use(s) in client code:\n  ${hits.join("\n  ")}` : "PASS  no UTC \"today\" in client code (use labTodayIso)");
process.exit(hits.length ? 1 : 0);
