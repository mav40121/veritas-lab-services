// Verify Article JSON-LD was added to the 11 previously meta-only resource
// articles, with a faithful (non-trivial) articleBody and no em dashes, and that
// the CalVer route retained its FAQPage + DefinedTerm nodes.
// Run: npx tsx scripts/verify-article-schema.mts
import { seoMetadataMap } from "../server/seo-metadata";

const ROUTES = [
  "/resources/clia-calibration-verification-method-comparison",
  "/resources/how-veritaassure-trains-lab-leaders",
  "/resources/calibration-verification-requirements-clia",
  "/resources/how-to-perform-method-comparison-study",
  "/resources/tjc-laboratory-inspection-checklist-preparation",
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

for (const r of ROUTES) {
  const meta = seoMetadataMap[r];
  const blocks: any[] = Array.isArray(meta?.jsonLd) ? meta.jsonLd : meta?.jsonLd ? [meta.jsonLd] : [];
  const art = blocks.find((b) => b?.["@type"] === "Article");
  const body: string = typeof art?.articleBody === "string" ? art.articleBody : "";
  check(`${r} :: has Article node`, !!art);
  check(`${r} :: articleBody >= 200 chars`, body.length >= 200, `${body.length} chars`);
  check(`${r} :: articleBody no em dash`, !body.includes("—"));
  check(`${r} :: headline present`, typeof art?.headline === "string" && art.headline.length > 0);
  check(`${r} :: mainEntityOfPage correct`, art?.mainEntityOfPage === `https://www.veritaslabservices.com${r}`);
  check(`${r} :: author is Michael Veri`, art?.author?.name === "Michael Veri");
  check(`${r} :: publisher @id ref`, art?.publisher?.["@id"] === "https://www.veritaslabservices.com/#organization");
}

// CalVer must still carry its FAQPage + DefinedTerm alongside the new Article.
const cv = seoMetadataMap["/resources/clia-calibration-verification-method-comparison"];
const cvBlocks: any[] = Array.isArray(cv.jsonLd) ? cv.jsonLd : cv.jsonLd ? [cv.jsonLd] : [];
check("CalVer :: retained FAQPage", cvBlocks.some((b) => b?.["@type"] === "FAQPage"));
check("CalVer :: retained DefinedTerm", cvBlocks.some((b) => b?.["@type"] === "DefinedTerm"));
check("CalVer :: Article is first block", cvBlocks[0]?.["@type"] === "Article");

// The pre-existing 3 Article routes must still be intact.
for (const r of [
  "/resources/ep26-reagent-lot-verification",
  "/resources/clia-tea-what-lab-directors-dont-know",
  "/resources/quality-control-testing-into-compliance",
]) {
  const blocks: any[] = Array.isArray(seoMetadataMap[r]?.jsonLd) ? (seoMetadataMap[r].jsonLd as any[]) : [];
  const art = blocks.find((b) => b?.["@type"] === "Article");
  const body: string = typeof art?.articleBody === "string" ? art.articleBody : "";
  check(`${r} :: pre-existing Article intact + enriched body`, !!art && body.length >= 100, `${body.length} chars`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
