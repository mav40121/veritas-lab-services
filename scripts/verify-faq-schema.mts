// scripts/verify-faq-schema.mts
//
// Gate 3 receipt for GEO Item 1 (FAQPage) + Item 3 (DefinedTerm). Imports the
// REAL server SEO map and the single-source FAQ content, then asserts:
//   - each FAQ-bearing route emits a FAQPage block whose mainEntity is verbatim
//     equal to the visible Q&A (drift between schema and page = FAIL),
//   - the DefinedTerm blocks are present and well-formed,
//   - the TEa Article block is preserved,
//   - every block round-trips through the static.ts "<" escaping as valid JSON.
//
// Run: npx tsx scripts/verify-faq-schema.mts

import { seoMetadataMap } from "../server/seo-metadata";
import {
  TEA_ARTICLE_FAQ,
  CALVER_ARTICLE_FAQ,
  FAQ_CATEGORIES,
  flattenFaq,
  type FaqQA,
} from "../client/src/lib/faqContent";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

type Block = Record<string, any>;
function blocksFor(route: string): Block[] {
  const j = (seoMetadataMap as any)[route]?.jsonLd;
  if (!j) return [];
  return Array.isArray(j) ? j : [j];
}
const faqBlock = (bs: Block[]) => bs.find((b) => b["@type"] === "FAQPage");
const typeBlock = (bs: Block[], t: string) => bs.find((b) => b["@type"] === t);

// Assert a FAQPage block matches the source Q&A array verbatim and in order.
function assertFaqVerbatim(route: string, expected: FaqQA[]) {
  const bs = blocksFor(route);
  const fp = faqBlock(bs);
  check(`${route}: has FAQPage block`, !!fp);
  if (!fp) return;
  check(`${route}: @context schema.org`, fp["@context"] === "https://schema.org");
  const me = fp.mainEntity as Block[];
  check(`${route}: mainEntity count == ${expected.length}`, me?.length === expected.length, `got ${me?.length}`);
  let verbatim = true;
  expected.forEach((qa, i) => {
    const node = me?.[i];
    const okQ = node?.["@type"] === "Question" && node?.name === qa.q;
    const okA = node?.acceptedAnswer?.["@type"] === "Answer" && node?.acceptedAnswer?.text === qa.a;
    if (!okQ || !okA) {
      verbatim = false;
      console.log(`      mismatch @${i}: ${okQ ? "" : "Q"} ${okA ? "" : "A"}`);
    }
  });
  check(`${route}: every Q&A verbatim-equal to page source`, verbatim);
}

// Assert a DefinedTerm block exists with the right shape.
function assertDefinedTerm(route: string, name: string, pagePath: string) {
  const bs = blocksFor(route);
  const dt = bs.filter((b) => b["@type"] === "DefinedTerm").find((b) => b.name === name);
  check(`${route}: DefinedTerm "${name}" present`, !!dt);
  if (!dt) return;
  check(`${route}: DefinedTerm has non-empty description`, typeof dt.description === "string" && dt.description.length > 10);
  check(`${route}: DefinedTerm inDefinedTermSet -> page`, dt.inDefinedTermSet === `https://www.veritaslabservices.com${pagePath}`);
}

// Every block must serialize and survive the static.ts "<" escaping as valid JSON.
function assertSerializable(route: string) {
  for (const b of blocksFor(route)) {
    const escaped = JSON.stringify(b).replace(/</g, "\\u003c");
    try {
      const round = JSON.parse(escaped);
      check(`${route}: ${b["@type"]} round-trips through < escaping`, JSON.stringify(round) === JSON.stringify(b));
    } catch (e: any) {
      check(`${route}: ${b["@type"]} round-trips through < escaping`, false, e.message);
    }
  }
}

const TEA = "/resources/clia-tea-what-lab-directors-dont-know";
const CALVER = "/resources/clia-calibration-verification-method-comparison";
const FAQ = "/faq";

// TEa article: Article + FAQPage(5) + DefinedTerm(TEa)
check(`${TEA}: Article block preserved`, !!typeBlock(blocksFor(TEA), "Article"));
assertFaqVerbatim(TEA, TEA_ARTICLE_FAQ);
assertDefinedTerm(TEA, "CLIA Total Allowable Error (TEa)", TEA);
assertSerializable(TEA);

// Cal Ver article: FAQPage(6) + DefinedTerm(Calibration Verification)
assertFaqVerbatim(CALVER, CALVER_ARTICLE_FAQ);
assertDefinedTerm(CALVER, "Calibration Verification", CALVER);
assertSerializable(CALVER);

// /faq: FAQPage from all categories
assertFaqVerbatim(FAQ, flattenFaq(FAQ_CATEGORIES));
assertSerializable(FAQ);

console.log("");
console.log(`FAQ source counts: TEa=${TEA_ARTICLE_FAQ.length}, CalVer=${CALVER_ARTICLE_FAQ.length}, /faq=${flattenFaq(FAQ_CATEGORIES).length}`);
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
