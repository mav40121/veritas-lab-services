// scripts/verify-seo-product-prerender.mjs
//
// Receipt for the SEO/GEO product-page work: every JS-rendered product page must
// ship its feature block in the RAW HTML (not just the browser DOM), and must
// carry a SoftwareApplication node with a featureList in the JSON-LD graph.
//
// Batch 1 shipped /veritacheck + the trio (VeritaScan, VeritaMap, VeritaComp).
// Batch 2 adds /veritapolicy and /veritastaff. This asserts all six together so
// a later edit cannot quietly drop one.
//
// The JSON-LD half matters most: the whole @graph lives in ONE <script> tag, so
// a single malformed node does not degrade, it takes every other node with it.
// This parses it for real rather than grepping for the string "featureList".
//
// Run: node scripts/verify-seo-product-prerender.mjs

import { readFileSync } from "fs";

let failures = 0;
function check(name, cond, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

const staticSrc = readFileSync(new URL("../server/static.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const indexHtml = readFileSync(new URL("../client/index.html", import.meta.url), "utf8").replace(/\r\n/g, "\n");

const PRODUCTS = [
  { route: "/veritacheck",  fn: "renderVeritaCheckContent",  id: "#veritacheck",  mark: "VeritaCheck" },
  { route: "/veritascan",   fn: "renderVeritaScanContent",   id: "#veritascan",   mark: "VeritaScan" },
  { route: "/veritamap",    fn: "renderVeritaMapContent",    id: "#veritamap",    mark: "VeritaMap" },
  { route: "/veritacomp",   fn: "renderVeritaCompContent",   id: "#veritacomp",   mark: "VeritaComp" },
  { route: "/veritapolicy", fn: "renderVeritaPolicyContent", id: "#veritapolicy", mark: "VeritaPolicy" },
  { route: "/veritastaff",  fn: "renderVeritaStaffContent",  id: "#veritastaff",  mark: "VeritaStaff" },
];

console.log("\nCase 1: every product page has a prerender function AND is wired into injectSeoTags");
for (const p of PRODUCTS) {
  check(`${p.route}: ${p.fn}() is defined`, new RegExp(`function ${p.fn}\\(\\)`).test(staticSrc));
  // The wiring is what actually puts it in the response. A defined-but-unwired
  // function is the silent failure this catches: the page stays a ~330-char shell.
  const wired = new RegExp(`routePath === "${p.route}"[\\s\\S]{0,80}${p.fn}\\(\\)`).test(staticSrc);
  check(`${p.route}: wired into injectSeoTags`, wired);
}

console.log("\nCase 2: the JSON-LD @graph still parses (one bad node kills the whole block)");
const m = indexHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
check("found the ld+json script tag", !!m);
let graph = [];
if (m) {
  let parsed = null;
  try { parsed = JSON.parse(m[1]); } catch (e) { check("JSON.parse succeeds", false, e.message); }
  if (parsed) {
    check("JSON.parse succeeds", true);
    graph = parsed["@graph"] || [];
    check("@graph is a non-empty array", Array.isArray(graph) && graph.length > 0, `len ${graph.length}`);
  }
}

console.log("\nCase 3: each product has a SoftwareApplication node with a non-empty featureList");
const apps = graph.filter((n) => n["@type"] === "SoftwareApplication");
check(`found ${apps.length} SoftwareApplication nodes (VeritaAssure + 6 products = 7)`, apps.length === 7, `got ${apps.length}`);
for (const p of PRODUCTS) {
  const node = graph.find((n) => typeof n["@id"] === "string" && n["@id"].endsWith(p.id));
  check(`${p.mark}: node exists at ${p.id}`, !!node);
  if (!node) continue;
  check(`${p.mark}: is a SoftwareApplication`, node["@type"] === "SoftwareApplication");
  check(`${p.mark}: has a non-empty featureList`, Array.isArray(node.featureList) && node.featureList.length > 0,
    `got ${JSON.stringify(node.featureList)?.slice(0, 40)}`);
  check(`${p.mark}: isPartOf VeritaAssure`, node.isPartOf?.["@id"]?.endsWith("#veritaassure"));
  check(`${p.mark}: url points at its own page`, node.url === `https://www.veritaslabservices.com${p.route}`,
    `got ${node.url}`);
  check(`${p.mark}: has a description`, typeof node.description === "string" && node.description.length > 20);
}

console.log("\nCase 4: copy guardrails on the batch-2 blocks and featureLists");
{
  const policyFn = staticSrc.slice(staticSrc.indexOf("function renderVeritaPolicyContent"), staticSrc.indexOf("function renderVeritaStaffContent"));
  const staffStart = staticSrc.indexOf("function renderVeritaStaffContent");
  const staffFn = staticSrc.slice(staffStart, staticSrc.indexOf("function getIndexHtml"));
  const policyNode = graph.find((n) => n["@id"]?.endsWith("#veritapolicy"));
  const staffNode = graph.find((n) => n["@id"]?.endsWith("#veritastaff"));
  const surfaces = [
    ["/veritapolicy block", policyFn],
    ["/veritastaff block", staffFn],
    ["/veritapolicy featureList", JSON.stringify(policyNode?.featureList || [])],
    ["/veritastaff featureList", JSON.stringify(staffNode?.featureList || [])],
  ];
  for (const [label, text] of surfaces) {
    check(`${label}: no em dash`, !text.includes("—"));
  }
  // Dated accreditor manual references. The audit script owns the full rule; this
  // is the narrow version for the copy this PR adds.
  const DATED = /\b(TJC|CAP|AABB|COLA)\b[^.]{0,40}\b(20\d\d|19\d\d)\b|\b(20\d\d|19\d\d)\s+(edition|manual)\b/i;
  for (const [label, text] of surfaces) {
    check(`${label}: no dated accreditor manual reference`, !DATED.test(text));
  }
  check("/veritapolicy block: VeritaPolicy carries the trademark mark", /VeritaPolicy&#8482;/.test(policyFn));
  check("/veritastaff block: VeritaStaff carries the trademark mark", /VeritaStaff&#8482;/.test(staffFn));
  check("/veritastaff block: VeritaMap carries the trademark mark", /VeritaMap&#8482;/.test(staffFn));
}

console.log("\nCase 5: batch-2 counts match the live page, not a restatement from memory");
{
  const page = readFileSync(new URL("../client/src/pages/VeritaPolicyPage.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const policyFn = staticSrc.slice(staticSrc.indexOf("function renderVeritaPolicyContent"), staticSrc.indexOf("function renderVeritaStaffContent"));
  // Pull each accreditor's count straight out of ACCREDITOR_PROFILES and assert
  // the prose repeats THAT number. If someone retunes the master list, this fails
  // rather than letting the marketing copy drift away from the product.
  for (const [key, expected] of [["TJC", 88], ["CAP", 65], ["COLA", 81], ["CLIA", 286]]) {
    const blockStart = page.indexOf(`  ${key}: {`) >= 0 ? page.indexOf(`  ${key}: {`) : page.indexOf(`${key}: {`);
    const block = page.slice(blockStart, blockStart + 260);
    const found = Number((block.match(/count:\s*(\d+)/) || [])[1]);
    check(`${key}: live page says ${expected}`, found === expected, `page says ${found}`);
    check(`${key}: prerender copy repeats ${expected}`, policyFn.includes(String(expected)));
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
