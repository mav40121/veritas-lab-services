// Verify Article JSON-LD across the resource articles, and the GEO authority /
// entity-graph wiring on the mock-inspection cornerstone:
//   - every article has a faithful (non-trivial) articleBody, no em dashes;
//   - every article's author resolves to the single #michael-veri Person node by
//     @id (not an inline Person);
//   - the #michael-veri Person node exists in the global @graph (client/index.html)
//     with sameAs, knowsAbout, and hasCredential;
//   - the cornerstone Article is connected into the graph: isPartOf #website,
//     about -> two DefinedTerm @ids that both resolve, mentions the two products
//     it touches, and a BreadcrumbList parses; all six FAQ questions are present.
// The whole @graph is JSON.parsed, never grepped (one bad comma kills the block).
// Run: npx tsx scripts/verify-article-schema.mts
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { seoMetadataMap } from "../server/seo-metadata";

const BASE = "https://www.veritaslabservices.com";
const CORNERSTONE = "/resources/tjc-laboratory-inspection-what-to-expect";

const ROUTES = [
  "/resources/clia-calibration-verification-method-comparison",
  "/resources/how-veritaassure-trains-lab-leaders",
  "/resources/calibration-verification-requirements-clia",
  "/resources/how-to-perform-method-comparison-study",
  "/resources/how-to-validate-veritacheck-clia",
  "/resources/laboratory-inventory-management",
  "/resources/manual-logs-why-most-labs-should-stop",
  "/resources/precision-verification-report-interpretation-guide",
  "/resources/cost-per-reportable-test-four-layer-framework",
  "/resources/why-veritacheck-vs-legacy-verification",
];

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}${detail ? "  (" + detail + ")" : ""}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? "  (" + detail + ")" : ""}`);
  }
}

function blocksFor(route: string): any[] {
  const meta = seoMetadataMap[route];
  return Array.isArray(meta?.jsonLd) ? (meta.jsonLd as any[]) : meta?.jsonLd ? [meta.jsonLd as any] : [];
}

for (const r of ROUTES) {
  const blocks = blocksFor(r);
  const art = blocks.find((b) => b?.["@type"] === "Article");
  const body: string = typeof art?.articleBody === "string" ? art.articleBody : "";
  check(`${r} :: has Article node`, !!art);
  check(`${r} :: articleBody >= 200 chars`, body.length >= 200, `${body.length} chars`);
  check(`${r} :: articleBody no em dash`, !body.includes("—"));
  check(`${r} :: headline present`, typeof art?.headline === "string" && art.headline.length > 0);
  check(`${r} :: mainEntityOfPage correct`, art?.mainEntityOfPage === `${BASE}${r}`);
  // Author is the shared entity referenced by @id, never an inline Person.
  check(`${r} :: author resolves to #michael-veri by @id`, art?.author?.["@id"] === `${BASE}/#michael-veri`);
  check(`${r} :: publisher @id ref`, art?.publisher?.["@id"] === `${BASE}/#organization`);
  check(`${r} :: isPartOf #website`, art?.isPartOf?.["@id"] === `${BASE}/#website`);
}

// --- The #michael-veri Person node lives in the global @graph in client/index.html.
// Parse the whole graph (do not grep) and assert the authority signals exist.
const htmlPath = join(dirname(fileURLToPath(import.meta.url)), "../client/index.html");
const html = readFileSync(htmlPath, "utf-8");
const ldBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  .map((m) => {
    try {
      return JSON.parse(m[1]);
    } catch (e) {
      check("index.html :: every ld+json block parses", false, String(e));
      return null;
    }
  })
  .filter(Boolean) as any[];

const graphObj = ldBlocks.find((b) => Array.isArray(b?.["@graph"]));
check("index.html :: @graph block present and parses", !!graphObj);
const graph: any[] = graphObj?.["@graph"] ?? [];
const person = graph.find((n) => n?.["@id"] === `${BASE}/#michael-veri`);
check("Person :: #michael-veri node exists", !!person);
check("Person :: @type Person", person?.["@type"] === "Person");
check("Person :: worksFor #organization", person?.worksFor?.["@id"] === `${BASE}/#organization`);
check("Person :: jobTitle present", typeof person?.jobTitle === "string" && person.jobTitle.length > 0);
check(
  "Person :: sameAs includes LinkedIn",
  Array.isArray(person?.sameAs) && person.sameAs.some((u: string) => u.includes("linkedin.com/in/michael-veri")),
);
check("Person :: knowsAbout non-empty", Array.isArray(person?.knowsAbout) && person.knowsAbout.length >= 1, `${person?.knowsAbout?.length ?? 0} items`);
check(
  "Person :: hasCredential non-empty with credentialCategory",
  Array.isArray(person?.hasCredential) &&
    person.hasCredential.length >= 1 &&
    person.hasCredential.every((c: any) => typeof c?.credentialCategory === "string" && c.credentialCategory.length > 0),
  `${person?.hasCredential?.length ?? 0} credentials`,
);

// --- Cornerstone entity-graph wiring.
const corner = blocksFor(CORNERSTONE);
const cornerArt = corner.find((b) => b?.["@type"] === "Article");
check("Cornerstone :: has Article node", !!cornerArt);
check("Cornerstone :: author resolves to #michael-veri", cornerArt?.author?.["@id"] === `${BASE}/#michael-veri`);
check("Cornerstone :: isPartOf #website", cornerArt?.isPartOf?.["@id"] === `${BASE}/#website`);

// about -> two DefinedTerm @ids, both of which must resolve to a DefinedTerm block
// on the same route.
const aboutIds: string[] = Array.isArray(cornerArt?.about) ? cornerArt.about.map((a: any) => a?.["@id"]) : [];
const definedTermIds = new Set(
  corner.filter((b) => b?.["@type"] === "DefinedTerm" && b?.["@id"]).map((b) => b["@id"] as string),
);
check("Cornerstone :: about has 2 entries", aboutIds.length === 2, aboutIds.join(", "));
for (const id of [`${BASE}/#term-laboratory-mock-inspection`, `${BASE}/#term-tracer-methodology`]) {
  check(`Cornerstone :: about references ${id.split("#")[1]}`, aboutIds.includes(id));
  check(`Cornerstone :: ${id.split("#")[1]} resolves to a DefinedTerm`, definedTermIds.has(id));
}

// mentions -> only the two products the article legitimately touches.
const mentionIds: string[] = Array.isArray(cornerArt?.mentions) ? cornerArt.mentions.map((a: any) => a?.["@id"]) : [];
check("Cornerstone :: mentions VeritaScan", mentionIds.includes(`${BASE}/#veritascan`));
check("Cornerstone :: mentions VeritaCheck", mentionIds.includes(`${BASE}/#veritacheck`));
check("Cornerstone :: mentions not stuffed (exactly 2)", mentionIds.length === 2, mentionIds.join(", "));

// BreadcrumbList parses with a 3-level trail.
const breadcrumb = corner.find((b) => b?.["@type"] === "BreadcrumbList");
check("Cornerstone :: BreadcrumbList present", !!breadcrumb);
check("Cornerstone :: BreadcrumbList has 3 items", Array.isArray(breadcrumb?.itemListElement) && breadcrumb.itemListElement.length === 3);

// All six FAQ questions present in the FAQPage node.
const faqPage = corner.find((b) => b?.["@type"] === "FAQPage");
const faqQuestions: any[] = Array.isArray(faqPage?.mainEntity) ? faqPage.mainEntity : [];
check("Cornerstone :: FAQPage has 6 questions", faqQuestions.length === 6, `${faqQuestions.length} questions`);

// CalVer must still carry its FAQPage + DefinedTerm alongside the new Article.
const cvBlocks = blocksFor("/resources/clia-calibration-verification-method-comparison");
check("CalVer :: retained FAQPage", cvBlocks.some((b) => b?.["@type"] === "FAQPage"));
check("CalVer :: retained DefinedTerm", cvBlocks.some((b) => b?.["@type"] === "DefinedTerm"));
check("CalVer :: Article is first block", cvBlocks[0]?.["@type"] === "Article");

// The pre-existing 3 Article routes must still be intact.
for (const r of [
  "/resources/ep26-reagent-lot-verification",
  "/resources/clia-tea-what-lab-directors-dont-know",
  "/resources/quality-control-testing-into-compliance",
]) {
  const blocks = blocksFor(r);
  const art = blocks.find((b) => b?.["@type"] === "Article");
  const body: string = typeof art?.articleBody === "string" ? art.articleBody : "";
  check(`${r} :: pre-existing Article intact + enriched body`, !!art && body.length >= 100, `${body.length} chars`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
