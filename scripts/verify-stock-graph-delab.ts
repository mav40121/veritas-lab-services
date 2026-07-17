// scripts/verify-stock-graph-delab.ts
//
// Receipt for the VeritaStock de-lab graph gate.
//
// The standing rule: on anything coming off veritastock.com, "lab",
// "laboratory" and "compliance" must not appear AT ALL, not even negated.
//
// client/index.html carries one ld+json @graph describing the VeritaAssure
// suite. It lives in <head>, so it shipped on veritastock.com too: 26
// occurrences of "laboratory"/"compliance" reaching crawlers there via the
// Organization name, the ProfessionalService node, and the per-product
// descriptions. The title and meta were already rewritten for that host; the
// graph was not. Found 2026-07-17 by fetching www.veritastock.com as Googlebot.
//
// This is a .ts run under tsx (the repo already ships tsx and other scripts use
// it) so it IMPORTS the real applyStockBranding and runs it over the real
// client/index.html. An earlier .mjs version tried to parse the transform out
// of the source text and could only ever prove its own re-implementation. The
// bug was never in a constant. It was that a correct suite graph got served on
// the wrong host, which is a property of the rendered output.
//
// Run: npx tsx scripts/verify-stock-graph-delab.ts

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import {
  applyStockBranding,
  STOCK_JSON_LD_GRAPH,
  LD_JSON_RE,
} from "../shared/stockBranding";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(path.resolve(here, "../client/index.html"), "utf8").replace(/\r\n/g, "\n");

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) console.log(`  PASS  ${name}`);
  else { failures++; console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`); }
}

// Everything the de-lab rule forbids, plus the adjacent regulatory vocabulary
// that carries the same association.
const BANNED = /\blabs?\b|\blaborator(y|ies)\b|\bcompliance\b|\bcompliant\b|\bCLIA\b|\bsurveyor?s?\b|\baccreditation\b|\baccreditor\b|Veritas Lab Services/i;

const suiteHtml = indexHtml;               // STOCK_DEPLOYMENT = false
const stockHtml = applyStockBranding(indexHtml); // STOCK_DEPLOYMENT = true

function headOf(h: string) { return h.split("</head>")[0]; }
function graphOf(h: string) {
  const m = h.match(LD_JSON_RE);
  if (!m) return null;
  return JSON.parse(m[0].replace(/<\/?script[^>]*>/g, ""));
}

console.log("\nCase 1: the SUITE render is untouched (veritaslabservices.com must stay lab-worded)");
{
  const g = graphOf(suiteHtml);
  check("suite graph parses", !!g);
  const nodes = g?.["@graph"] ?? [];
  check("suite graph keeps its Organization", nodes.some((n: any) => n["@type"] === "Organization"));
  check("suite graph keeps its SoftwareApplication nodes", nodes.filter((n: any) => n["@type"] === "SoftwareApplication").length >= 7);
  check("suite still says laboratory (this is its actual business)", /laborator/i.test(JSON.stringify(nodes)));
  check("suite <title> is NOT the stock title", !/Multi-Location Inventory Management/.test(headOf(suiteHtml)));
}

console.log("\nCase 2: the STOCK graph carries not one banned token");
{
  const flat = JSON.stringify(STOCK_JSON_LD_GRAPH);
  const hit = flat.match(BANNED);
  check("no lab / laboratory / compliance / CLIA / surveyor / accreditation / legal name",
    !hit, hit ? `found ${JSON.stringify(hit[0])}` : "");
  const nodes = STOCK_JSON_LD_GRAPH["@graph"] as any[];
  check("no Organization node (its name would be the legal name)",
    !nodes.some((n) => n["@type"] === "Organization"));
  const app = nodes.find((n) => n["@type"] === "SoftwareApplication");
  check("has a VeritaStock SoftwareApplication node", app?.name === "VeritaStock");
  check("its featureList is non-empty", Array.isArray(app?.featureList) && app.featureList.length > 0);
  check("its url is the stock host", app?.url === "https://www.veritastock.com");
  check("no isPartOf pointing at a node that does not exist on this host", !app?.isPartOf);
  check("no dangling publisher reference", !nodes.some((n) => n.publisher));
}

console.log("\nCase 3: the RENDERED stock <head> is clean (this is the actual rule)");
{
  const head = headOf(stockHtml);
  const suiteHead = headOf(suiteHtml);
  const count = (s: string) => (s.match(/laborator|compliance/gi) || []).length;
  console.log(`    suite <head> laboratory/compliance tokens: ${count(suiteHead)}`);
  console.log(`    stock <head> laboratory/compliance tokens: ${count(head)}`);
  check("stock <head> has ZERO laboratory/compliance tokens", count(head) === 0, `got ${count(head)}`);
  check("suite <head> still has them", count(suiteHead) > 0);
  check("stock render actually changed the html", stockHtml !== suiteHtml);
  check("exactly one ld+json block survives the swap",
    (stockHtml.match(/<script type="application\/ld\+json">/g) || []).length === 1);
  const g = graphOf(stockHtml);
  check("the swapped-in graph parses in the rendered output", !!g);
  check("rendered stock graph is the stock graph",
    JSON.stringify(g) === JSON.stringify(STOCK_JSON_LD_GRAPH));
  check("stock <title> is the stock title", /Multi-Location Inventory Management/.test(head));
}

console.log("\nCase 4: applyStockBranding is pure and idempotent-safe");
{
  const once = applyStockBranding(indexHtml);
  const twice = applyStockBranding(applyStockBranding(indexHtml));
  check("running it twice does not double-apply or corrupt", once === twice);
  check("it does not mutate its input", indexHtml === suiteHtml);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
