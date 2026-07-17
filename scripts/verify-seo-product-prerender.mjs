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

// /veritabench is deliberately NOT here, and NOT because VeritaBench is missing.
// VeritaBench's page is /calculator, which has shipped a prerender block since
// the batch-1 era (renderProductivityCalculatorContent). /veritabench is a legacy
// slug that renders VeritaPace: its h1, useSEO title and hero all say VeritaPace.
// A "VeritaBench is..." block there would publish a product identity the page
// itself contradicts. OperationsPage.tsx MODULES is the authoritative route map.
// Case 4b below pins BOTH halves: the absence at /veritabench and the presence
// at /calculator, so this cannot be re-misread as an open TODO.

// The two hub pages. Neither is a PRODUCTS row, for reasons the shapes differ:
//   /veritaassure IS the suite. Its node is the "+1" in the Case 3 count, and it
//     correctly carries NO isPartOf (the other ten are isPartOf IT). Adding it to
//     PRODUCTS would both break that count and assert an isPartOf that must not
//     exist.
//   /operations has NO node at all. It is a hub, not a product, and every node
//     added to the suite graph is a node the stock host has to filter. Prerender
//     only. A PRODUCTS row would assert a node and fail.
const SUITE = { route: "/veritaassure", fn: "renderVeritaAssureContent", id: "#veritaassure", mark: "VeritaAssure", features: 10 };
const HUB = { route: "/operations", fn: "renderOperationsContent", mark: "VeritaAssure" };

// Batch 7. The two pages that sell the consultant, not the software. No schema
// node: same reasoning as HUB, they are not products. They are listed separately
// from PRODUCTS because a PRODUCTS row asserts a SoftwareApplication node.
//
// These exist because batches 3 and 4 made every product page crawlable while
// /services and /team stayed ~530-char shells. The resource articles trade on the
// former-surveyor credential to earn the reader's trust, and the page that
// substantiates that credential was the one page a crawler could not read.
const CONSULTING = [
  { route: "/services", fn: "renderServicesContent", mark: "consulting" },
  { route: "/team", fn: "renderTeamContent", mark: "credential" },
];

console.log("\nCase 1: every product page has a prerender function AND is wired into injectSeoTags");
for (const p of [...PRODUCTS, SUITE, HUB, ...CONSULTING]) {
  check(`${p.route}: ${p.fn}() is defined`, new RegExp(`function ${p.fn}\\(\\)`).test(staticSrc));
  // The wiring is what actually puts it in the response. A defined-but-unwired
  // function is the silent failure this catches: the page stays a ~520-char shell.
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

console.log("\nCase 3b: the suite node itself (#veritaassure), which is the '+1' above");
{
  const node = graph.find((n) => typeof n["@id"] === "string" && n["@id"].endsWith(SUITE.id));
  check(`${SUITE.mark}: node exists`, !!node);
  if (node) {
    check(`${SUITE.mark}: has a non-empty featureList`,
      Array.isArray(node.featureList) && node.featureList.length > 0);
    check(`${SUITE.mark}: featureList has ${SUITE.features} entries`,
      node.featureList?.length === SUITE.features, `got ${node.featureList?.length}`);
    // It IS the suite: the other ten are isPartOf it, so it must not be isPartOf
    // anything itself. Asserted rather than assumed, because "add isPartOf like
    // its siblings" is the obvious wrong edit for someone reading the pattern.
    check(`${SUITE.mark}: correctly has NO isPartOf`, node.isPartOf === undefined);
    // The description drifted three ways before batch 4 (named VeritaPace inside
    // the compliance list, omitted four shipped modules, said "method
    // verification"). Pin all three so it cannot silently drift back.
    const d = node.description || "";
    check(`${SUITE.mark}: description does not name VeritaPace among compliance modules`,
      !/VeritaPace, VeritaShift/.test(d.split("six operations modules")[0]));
    for (const mod of ["VeritaQC", "VeritaTrack", "VeritaPT", "VeritaResponse"]) {
      check(`${SUITE.mark}: description names ${mod}`, d.includes(mod));
    }
    // CLAUDE.md section 3: labs verify, manufacturers validate.
    check(`${SUITE.mark}: says "performance verification", not "method verification"`,
      d.includes("performance verification") && !/method verification/i.test(d));
  }
}

console.log("\nCase 3c: /operations is prerender-only and stays out of the graph");
{
  // Deliberate. Asserted so a later batch does not "complete the pattern" by
  // adding a node for a page that is a hub, not a product.
  check("/operations: no #operations node in the graph",
    !graph.some((n) => typeof n["@id"] === "string" && n["@id"].endsWith("#operations")));
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

  // Includes SUITE and HUB: the guardrails apply to every block that ships, not
  // just the ten product ones. HUB has no id, so its featureList lookup is a
  // no-op and only the block half of the guardrails applies to it.
  for (const p of [...PRODUCTS, SUITE, HUB, ...CONSULTING]) {
    const block = bodyOf(p.fn);
    const node = p.id ? graph.find((n) => n["@id"]?.endsWith(p.id)) : undefined;
    const fl = JSON.stringify(node?.featureList || []);
    check(`${p.route}: block found in source`, block.length > 0);
    check(`${p.route}: block has no em dash`, !block.includes("—"));
    check(`${p.route}: featureList has no em dash`, !fl.includes("—"));
    check(`${p.route}: block has no dated accreditor manual reference`, !DATED.test(block));
    check(`${p.route}: featureList has no dated accreditor manual reference`, !DATED.test(fl));
    // The trademark check only applies to blocks naming a product. /services and
    // /team sell a person, so their "mark" is a topic label, not a product name.
    if (!CONSULTING.includes(p)) {
      check(`${p.route}: ${p.mark} carries the trademark mark`,
        new RegExp(`${p.mark}&#8482;`).test(block));
    }
  }
  // Cross-product marks appearing inside another product's copy.
  check("/veritastaff block marks VeritaMap", /VeritaMap&#8482;/.test(bodyOf("renderVeritaStaffContent")));
  check("/veritatrack block marks VeritaMap", /VeritaMap&#8482;/.test(bodyOf("renderVeritaTrackContent")));
  check("/veritapt block marks VeritaScan", /VeritaScan&#8482;/.test(bodyOf("renderVeritaPTContent")));
}

console.log("\nCase 4c: the consulting pages state the credential faithfully");
{
  const bodyOf = (fnName) => {
    const start = staticSrc.indexOf(`function ${fnName}(`);
    if (start < 0) return "";
    return staticSrc.slice(start, staticSrc.indexOf("\n}", start));
  };
  const team = bodyOf("renderTeamContent");
  const services = bodyOf("renderServicesContent");
  const teamPage = readFileSync(new URL("../client/src/pages/TeamPage.tsx", import.meta.url), "utf8");

  // Every credential here is a claim about a real person, so each traces to the
  // page that already makes it. These are the ones that would quietly become a
  // false statement if the copy drifted.
  check("TeamPage itself claims the 4-year TJC surveyor tenure", /Surveyor \(4 years\)/.test(teamPage));
  check("/team block says four years, matching TeamPage", /four years/.test(team));
  check("/team block says Joint Commission, never CMS", /Joint Commission/.test(team) && !/CMS surveyor/i.test(team));

  // Lab Management 101 is NOT published. Saying otherwise is a fabricated claim
  // about a real book, and TeamPage marks it forthcoming.
  check("TeamPage marks Lab Management 101 forthcoming", /forthcoming/i.test(teamPage));
  check("/team block preserves 'forthcoming' on Lab Management 101",
    /Lab Management 101[^.]*forthcoming/i.test(team));

  // Standing rule: LabVine Learning references are removed permanently.
  for (const [name, b] of [["/team", team], ["/services", services]]) {
    check(`${name} block has no LabVine reference`, !/labvine/i.test(b));
    // Labs verify, manufacturers validate.
    check(`${name} block does not say "validation" of lab work`, !/method validation|validation suite/i.test(b));
  }

  // /services must name what is actually sold, not a generic pitch.
  for (const line of ["mock inspections", "productivity", "coaching"]) {
    check(`/services block names the ${line} service line`, new RegExp(line, "i").test(services));
  }
}

console.log("\nCase 4b: VeritaBench lives at /calculator; /veritabench is a legacy VeritaPace slug");
{
  // Both halves, because asserting only the absence is what let this read as an
  // open TODO ("VeritaBench is missing, blocked on a product decision") when in
  // fact VeritaBench shipped and /veritabench is simply the wrong page for it.
  const bench = readFileSync(new URL("../client/src/pages/VeritaBenchPage.tsx", import.meta.url), "utf8");
  const ops = readFileSync(new URL("../client/src/pages/OperationsPage.tsx", import.meta.url), "utf8");

  // The route map, straight from the page that owns it.
  const routeOf = (label) => {
    const i = ops.indexOf(`label: "${label}`);
    const before = ops.slice(0, i);
    return (before.match(/href: "([^"]+)"/g) || []).pop()?.match(/"([^"]+)"/)?.[1];
  };
  check("OperationsPage maps VeritaBench to /calculator", routeOf("VeritaBench") === "/calculator", `got ${routeOf("VeritaBench")}`);
  check("OperationsPage maps VeritaPace to /veritabench", routeOf("VeritaPace") === "/veritabench", `got ${routeOf("VeritaPace")}`);

  // Presence: VeritaBench's real page ships a block.
  check("VeritaBench's page (/calculator) IS prerendered", /routePath === "\/calculator"[\s\S]{0,80}renderProductivityCalculatorContent\(\)/.test(staticSrc));

  // Absence: the legacy slug renders VeritaPace, so no VeritaBench block there.
  check("VeritaBenchPage renders VeritaPace (why the slug gets no block)", /VeritaPace/.test(bench));
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
