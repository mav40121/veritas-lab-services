// scripts/verify-seo-title-parity.mjs
// Every marketing page carries its title and description twice: server/seo-metadata.ts writes them into the HTML the
// server sends, and the page's useSEO({ title, description }) call (client/src/hooks/useSEO.ts) overwrites
// document.title and the meta description once the page renders, which is what Google indexes. The 10/2 title fixes
// went only into seo-metadata.ts (SEO handoff 2026-11-09, Part 1), so on 12 routes the rendered title was still the old
// one. This check fails when a route's literal useSEO title or description differs from its seo-metadata.ts entry.
//
//   node scripts/verify-seo-title-parity.mjs
//
// Reads this checkout's files only (no git, no network). For each route in seoMetadataMap it finds the page component
// client/src/App.tsx renders there, reads that page file's useSEO call, and compares:
//   PASS  both literal values equal the server's
//   FAIL  a literal value differs (prints the route and both strings); exit 1
//   SKIP  a value is computed (not a string literal), so it can't be compared here
//   NONE  the page makes no useSEO call (the served title stands), or no page component renders the route
// Exit 2 if the parser finds implausibly few routes, so a broken parser can't pass by checking nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ---- a small JS/TS scanner: enough to walk object literals without being fooled by strings, templates or comments

// If a string, template literal or comment starts at src[i], the index just past it; otherwise -1.
function skipNonCode(src, i) {
  const c = src[i], n = src[i + 1];
  if (c === "/" && n === "/") { const e = src.indexOf("\n", i); return e < 0 ? src.length : e; }
  if (c === "/" && n === "*") { const e = src.indexOf("*/", i + 2); return e < 0 ? src.length : e + 2; }
  if (c === '"' || c === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  if (c === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== "`") {
      if (src[j] === "\\") { j += 2; continue; }
      if (src[j] === "$" && src[j + 1] === "{") { j = matchClose(src, j + 1) + 1; continue; }
      j++;
    }
    return j + 1;
  }
  return -1;
}

// src[open] is ( [ or {; the index of the bracket that closes it.
function matchClose(src, open) {
  let depth = 0;
  for (let i = open; i < src.length;) {
    const s = skipNonCode(src, i);
    if (s >= 0) { i = s; continue; }
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) return i; }
    i++;
  }
  throw new Error(`unbalanced bracket at offset ${open}`);
}

const skipSpace = (src, i, end) => {
  for (;;) {
    while (i < end && /\s/.test(src[i])) i++;
    if (src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*")) { i = skipNonCode(src, i); continue; }
    return i;
  }
};

// The top-level properties of the object literal whose "{" is at src[open], as Map(key -> raw value source).
// A spread, shorthand or method property has no ":" value and is recorded with value null.
function objectProps(src, open) {
  const close = matchClose(src, open);
  const props = new Map();
  let i = open + 1;
  while (i < close) {
    i = skipSpace(src, i, close);
    if (i >= close) break;
    if (src[i] === ",") { i++; continue; }
    let key = null;
    if (src[i] === '"' || src[i] === "'") {
      const e = skipNonCode(src, i);
      key = decode(src.slice(i + 1, e - 1));
      i = e;
    } else {
      const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i, i + 200));
      if (m) { key = m[0]; i += m[0].length; }
    }
    i = skipSpace(src, i, close);
    const hasValue = src[i] === ":";
    if (hasValue) i++;
    const start = i;
    // Read to the comma that ends this property (at this object's depth) or to the closing brace.
    while (i < close) {
      const s = skipNonCode(src, i);
      if (s >= 0) { i = s; continue; }
      const c = src[i];
      if (c === "(" || c === "[" || c === "{") { i = matchClose(src, i) + 1; continue; }
      if (c === ",") break;
      i++;
    }
    if (key !== null) props.set(key, hasValue ? src.slice(start, i) : null);
  }
  return props;
}

// Decode the body of a JS string literal (the text between the quotes).
function decode(body) {
  return body.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|\r?\n|[\s\S])/g, (m, all, cp, u4, x2) => {
    if (cp) return String.fromCodePoint(parseInt(cp, 16));
    if (u4) return String.fromCharCode(parseInt(u4, 16));
    if (x2) return String.fromCharCode(parseInt(x2, 16));
    if (all === "\n" || all === "\r\n") return ""; // line continuation
    return { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", v: "\v", 0: "\0" }[all] ?? all;
  });
}

// The decoded string if raw is exactly one string literal (a template only without ${}); otherwise null (computed).
function stringLiteral(raw) {
  if (raw == null) return null;
  const t = raw.trim();
  if (!t || !`"'\``.includes(t[0])) return null;
  if (skipNonCode(t, 0) !== t.length) return null; // concatenation, ternary, call, "as const" ...
  const body = t.slice(1, -1);
  if (t[0] === "`" && body.replace(/\\[\s\S]/g, "").includes("${")) return null;
  return decode(body);
}

// ---- server side: seoMetadataMap in server/seo-metadata.ts

const META_FILE = "server/seo-metadata.ts";
const metaSrc = read(META_FILE);
const decl = metaSrc.search(/export const seoMetadataMap\b/);
if (decl < 0) { console.error(`Cannot find seoMetadataMap in ${META_FILE}`); process.exit(2); }
const mapOpen = metaSrc.indexOf("{", metaSrc.indexOf("=", decl));
const server = new Map(); // route -> { title, description } (null where not a literal)
for (const [route, raw] of objectProps(metaSrc, mapOpen)) {
  if (!route.startsWith("/") || raw == null) continue;
  const t = raw.trim();
  if (t[0] !== "{") continue;
  const local = raw.indexOf("{");
  const props = objectProps(raw, local);
  server.set(route, { title: stringLiteral(props.get("title")), description: stringLiteral(props.get("description")) });
}

// ---- client side: which page component client/src/App.tsx renders on each route

const APP_FILE = "client/src/App.tsx";
const app = read(APP_FILE);
const pageOf = new Map(); // component identifier -> page module path under client/src/pages
for (const m of app.matchAll(/(?:const|let)\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*["']@\/pages\/([^"']+)["']/g)) pageOf.set(m[1], m[2]);
for (const m of app.matchAll(/import\s+(\w+)\s+from\s+["']@\/pages\/([^"']+)["']/g)) pageOf.set(m[1], m[2]);
for (const m of app.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/pages\/([^"']+)["']/g)) {
  for (const part of m[1].split(",")) {
    const name = part.trim().split(/\s+as\s+/).pop();
    if (name) pageOf.set(name, m[2]);
  }
}
// One level of wrapping, e.g. const StaffGatedPace = staffLoginGate(VeritaPacePage, "VeritaPace™");
for (const m of app.matchAll(/(?:const|let)\s+(\w+)\s*=\s*\w+\(\s*(\w+)\s*[,)]/g)) {
  if (!pageOf.has(m[1]) && pageOf.has(m[2])) pageOf.set(m[1], pageOf.get(m[2]));
}

const routePages = new Map(); // route -> { pages: [module], note }
for (const m of app.matchAll(/<Route\b/g)) {
  // The opening tag ends at the first ">" outside braces and strings.
  let i = m.index + m[0].length;
  while (i < app.length && app[i] !== ">") {
    if (app[i] === "{") { i = matchClose(app, i) + 1; continue; }
    const s = skipNonCode(app, i);
    i = s >= 0 ? s : i + 1;
  }
  const attrs = app.slice(m.index, i);
  const selfClosing = app[i - 1] === "/";
  const pathM = /\bpath=["']([^"']+)["']/.exec(attrs);
  if (!pathM || routePages.has(pathM[1])) continue; // inside <Switch> the first match wins
  const names = [];
  const compM = /\bcomponent=\{\s*(\w+)\s*\}/.exec(attrs);
  if (compM) names.push(compM[1]);
  let note = "";
  if (!selfClosing) {
    const children = app.slice(i + 1, app.indexOf("</Route>", i));
    // "/" renders VeritaStockLandingPage on veritastock.com and HomePage here; seoMetadataMap is only injected
    // off the stock deployment (server/static.ts), so the branch to compare is the non-stock one.
    const host = /isStockHost\(\)\s*\?\s*<\w+[^:]*:\s*<(\w+)/.exec(children);
    if (host) { names.push(host[1]); note = "non-stock host branch"; }
    else {
      for (const w of children.matchAll(/wrapLegacy\(\s*(\w+)/g)) names.push(w[1]);
      for (const w of children.matchAll(/<([A-Z]\w*)\b/g)) names.push(w[1]);
    }
  }
  const pages = [...new Set(names.filter((n) => pageOf.has(n)).map((n) => pageOf.get(n)))];
  routePages.set(pathM[1], { pages, note });
}

function pageFile(mod) {
  for (const cand of [`${mod}.tsx`, `${mod}.ts`, `${mod}/index.tsx`, `${mod}/index.ts`]) {
    const rel = `client/src/pages/${cand}`;
    if (fs.existsSync(path.join(ROOT, rel))) return rel;
  }
  return null;
}

// Every useSEO( call in a page file that isn't on a comment line.
function useSeoCalls(src) {
  const calls = [];
  for (const m of src.matchAll(/\buseSEO\s*\(/g)) {
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const prefix = src.slice(lineStart, m.index);
    if (prefix.includes("//") || /^\s*(\*|\/\*)/.test(prefix)) continue;
    const open = m.index + m[0].length - 1;
    const close = matchClose(src, open);
    const argStart = skipSpace(src, open + 1, close);
    if (src[argStart] !== "{" || skipSpace(src, matchClose(src, argStart) + 1, close + 1) < close) {
      calls.push({ computed: true });
      continue;
    }
    const props = objectProps(src, argStart);
    calls.push({ title: stringLiteral(props.get("title")), description: stringLiteral(props.get("description")) });
  }
  return calls;
}

// ---- compare

const rows = [];
let titleFails = 0, descFails = 0;
for (const [route, srv] of server) {
  const rp = routePages.get(route);
  if (!rp || rp.pages.length === 0) { rows.push({ status: "NONE", route, note: "no page component renders this route in App.tsx" }); continue; }
  if (rp.pages.length > 1) { rows.push({ status: "SKIP", route, file: rp.pages.join(", "), note: "more than one page component renders this route" }); continue; }
  const file = pageFile(rp.pages[0]);
  if (!file) { rows.push({ status: "NONE", route, note: `page module ${rp.pages[0]} not found` }); continue; }
  const short = path.basename(file) + (rp.note ? `, ${rp.note}` : "");
  const calls = useSeoCalls(read(file));
  if (calls.length === 0) { rows.push({ status: "NONE", route, file: short, note: "no useSEO call in the page; the served title stands" }); continue; }
  if (calls.length > 1) { rows.push({ status: "SKIP", route, file: short, note: `${calls.length} useSEO calls in the page` }); continue; }
  const call = calls[0];
  if (call.computed) { rows.push({ status: "SKIP", route, file: short, note: "useSEO argument is not an object literal" }); continue; }
  const diffs = [], skipped = [];
  for (const field of ["title", "description"]) {
    if (call[field] == null) { skipped.push(`useSEO ${field} is computed`); continue; }
    if (srv[field] == null) { skipped.push(`server ${field} is computed`); continue; }
    if (call[field] !== srv[field]) diffs.push({ field, server: srv[field], client: call[field] });
  }
  if (diffs.length) {
    for (const d of diffs) d.field === "title" ? titleFails++ : descFails++;
    rows.push({ status: "FAIL", route, file: short, diffs, note: skipped.join("; ") });
  } else if (skipped.length === 2) rows.push({ status: "SKIP", route, file: short, note: "title and description are computed, not string literals" });
  else rows.push({ status: "PASS", route, file: short, note: skipped.length ? `${skipped[0]}, not compared` : "" });
}

const count = (s) => rows.filter((r) => r.status === s).length;
console.log(`SEO title parity: ${META_FILE} vs each page's useSEO({ title, description })`);
console.log(`Server routes: ${server.size}. Compared: ${count("PASS") + count("FAIL")}. Skipped (computed): ${count("SKIP")}. No useSEO call or no page: ${count("NONE")}.\n`);
for (const r of rows) {
  console.log(`${r.status}  ${r.route}${r.file ? `  [${r.file}]` : ""}${r.note ? `  (${r.note})` : ""}`);
  for (const d of r.diffs || []) {
    console.log(`      ${d.field} differs`);
    console.log(`        server: ${JSON.stringify(d.server)}`);
    console.log(`        useSEO: ${JSON.stringify(d.client)}`);
  }
}

// A parser that silently matches nothing would "pass"; refuse that.
if (server.size < 30 || count("PASS") + count("FAIL") < 30) {
  console.error(`\nRESULT: ERROR, the parser found too few routes (server ${server.size}, compared ${count("PASS") + count("FAIL")}); fix the parser, not the threshold.`);
  process.exit(2);
}
if (count("FAIL")) {
  console.log(`\nRESULT: FAIL, ${count("FAIL")} route(s) differ (${titleFails} title, ${descFails} description). Make the page's useSEO values equal its ${META_FILE} entry.`);
  process.exit(1);
}
console.log(`\nRESULT: PASS, all ${count("PASS")} compared routes match.`);
