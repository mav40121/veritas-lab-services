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
  // Batch 3
  { route: "/veritatrack",  fn: "renderVeritaTrackContent",  id: "#veritatrack",  mark: "VeritaTrack" },
  { route: "/veritapt",     fn: "renderVeritaPTContent",     id: "#veritapt",     mark: "VeritaPT" },
  { route: "/veritalab",    fn: "renderVeritaLabContent",    id: "#veritalab",    mark: "VeritaLab" },
  { route: "/veritastock",  fn: "renderVeritaStockContent",  id: "#veritastock",  mark: "VeritaStock" },
];

// /veritabench is deliberately NOT here. It renders VeritaPace: the h1, the
// useSEO title and the hero all say VeritaPace, and there is no /veritapace
// route. A "VeritaBench is..." block there would publish a product identity the
// page itself contradicts. Blocked on a product decision, not a copy one.
// Case 4b below asserts that absence stays deliberate rather than an oversight.

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
check(`found ${apps.length} SoftwareApplication nodes (VeritaAssure + ${PRODUCTS.length} products = ${PRODUCTS.length + 1})`,
  apps.length === PRODUCTS.length + 1, `got ${apps.length}`);
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

console.log("\nCase 4: copy guardrails on EVERY product block and featureList");
{
  // Generalised over PRODUCTS rather than a hardcoded pair, so a later batch
  // cannot add copy that skips the guardrails just by not being named here.
  const bodyOf = (fnName) => {
    const start = staticSrc.indexOf(`function ${fnName}(`);
    if (start < 0) return "";
    return staticSrc.slice(start, staticSrc.indexOf("\n}", start));
  };
  // Dated accreditor manual references. The audit script owns the full rule;
  // this is the narrow version for the copy these blocks add.
  const DATED = /\b(TJC|CAP|AABB|COLA)\b[^.]{0,40}\b(20\d\d|19\d\d)\b|\b(20\d\d|19\d\d)\s+(edition|manual)\b/i;

  for (const p of PRODUCTS) {
    const block = bodyOf(p.fn);
    const node = graph.find((n) => n["@id"]?.endsWith(p.id));
    const fl = JSON.stringify(node?.featureList || []);
    check(`${p.route}: block found in source`, block.length > 0);
    check(`${p.route}: block has no em dash`, !block.includes("—"));
    check(`${p.route}: featureList has no em dash`, !fl.includes("—"));
    check(`${p.route}: block has no dated accreditor manual reference`, !DATED.test(block));
    check(`${p.route}: featureList has no dated accreditor manual reference`, !DATED.test(fl));
    check(`${p.route}: ${p.mark} carries the trademark mark`,
      new RegExp(`${p.mark}&#8482;`).test(block));
  }
  // Cross-product marks appearing inside another product's copy.
  check("/veritastaff block marks VeritaMap", /VeritaMap&#8482;/.test(bodyOf("renderVeritaStaffContent")));
  check("/veritatrack block marks VeritaMap", /VeritaMap&#8482;/.test(bodyOf("renderVeritaTrackContent")));
  check("/veritapt block marks VeritaScan", /VeritaScan&#8482;/.test(bodyOf("renderVeritaPTContent")));
}

console.log("\nCase 4b: /veritabench stays deliberately absent (it renders VeritaPace)");
{
  const bench = readFileSync(new URL("../client/src/pages/VeritaBenchPage.tsx", import.meta.url), "utf8");
  check("VeritaBenchPage still renders VeritaPace (the blocker)", /VeritaPace/.test(bench));
  check("no /veritabench prerender is wired", !/routePath === "\/veritabench"/.test(staticSrc));
  check("no #veritabench node in the graph", !graph.some((n) => n["@id"]?.endsWith("#veritabench")));
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
