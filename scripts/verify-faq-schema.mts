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

import { readFileSync } from "fs";
import { seoMetadataMap } from "../server/seo-metadata";
import {
  TEA_ARTICLE_FAQ,
  CALVER_ARTICLE_FAQ,
  TEA_LOOKUP_FAQ,
  CALVER_REQ_FAQ,
  METHODCOMP_FAQ,
  PRECISION_FAQ,
  CPRT_FAQ,
  MANUAL_LOGS_FAQ,
  REFINT_ARTICLE_FAQ,
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

// --- SEO agent Item A: 7 resource routes get FAQPage (+ DefinedTerm/HowTo) ---
function assertHowTo(route: string) {
  const bs = blocksFor(route);
  const ht = bs.find((b) => b["@type"] === "HowTo");
  check(`${route}: HowTo present`, !!ht);
  check(`${route}: HowTo has >= 3 steps`, Array.isArray(ht?.step) && ht.step.length >= 3);

  // Regression guard for the (s.name || s.text) drop: enrichArticleBodies took a
  // step's short `name` label and discarded its `text` instruction, so the
  // substantive half of every HowTo never reached articleBody.
  //
  // Phrased as an implication rather than an absolute, because it must hold for
  // COMPOSED bodies without firing on HAND-AUTHORED ones. enrichArticleBodies
  // short-circuits on an Article that already has an articleBody, so a hardcoded
  // body legitimately contains neither the names nor the text. If a step's name
  // is present, that body was composed, and then its text must be present too.
  const art = bs.find((b) => b["@type"] === "Article");
  const body: string = art?.articleBody || "";
  if (!body || !Array.isArray(ht?.step)) return;
  const composed = ht.step.filter((s: any) => s?.name && body.includes(s.name));
  if (composed.length === 0) return; // hand-authored articleBody: not our business
  const dropped = composed.filter((s: any) => s?.text && !body.includes(s.text));
  check(
    `${route}: composed articleBody keeps HowTo step TEXT, not just the name label`,
    dropped.length === 0,
    dropped.length ? `${dropped.length}/${composed.length} steps lost their text` : `${composed.length} steps intact`,
  );
}
function assertArticle(route: string) {
  check(`${route}: Article block present`, !!typeBlock(blocksFor(route), "Article"));
}
function assertNoEmDash(route: string) {
  check(`${route}: no em dash in JSON-LD`, !JSON.stringify(blocksFor(route)).includes("—"));
}

const TEA_LOOKUP = "/resources/clia-tea-lookup";
assertFaqVerbatim(TEA_LOOKUP, TEA_LOOKUP_FAQ);
assertSerializable(TEA_LOOKUP);
assertNoEmDash(TEA_LOOKUP);

const CALVER_REQ = "/resources/calibration-verification-requirements-clia";
assertArticle(CALVER_REQ);
assertFaqVerbatim(CALVER_REQ, CALVER_REQ_FAQ);
assertDefinedTerm(CALVER_REQ, "Calibration verification", CALVER_REQ);
assertSerializable(CALVER_REQ);
assertNoEmDash(CALVER_REQ);

const METHODCOMP = "/resources/how-to-perform-method-comparison-study";
assertArticle(METHODCOMP);
assertFaqVerbatim(METHODCOMP, METHODCOMP_FAQ);
assertHowTo(METHODCOMP);
assertSerializable(METHODCOMP);
assertNoEmDash(METHODCOMP);

const PRECISION = "/resources/precision-verification-report-interpretation-guide";
assertArticle(PRECISION);
assertFaqVerbatim(PRECISION, PRECISION_FAQ);
assertDefinedTerm(PRECISION, "Coefficient of variation", PRECISION);
assertSerializable(PRECISION);
assertNoEmDash(PRECISION);

const CPRT = "/resources/cost-per-reportable-test-four-layer-framework";
assertArticle(CPRT);
assertFaqVerbatim(CPRT, CPRT_FAQ);
assertDefinedTerm(CPRT, "Cost per reportable test", CPRT);
assertHowTo(CPRT);
assertSerializable(CPRT);
assertNoEmDash(CPRT);

const MANUAL_LOGS = "/resources/manual-logs-why-most-labs-should-stop";
assertArticle(MANUAL_LOGS);
assertFaqVerbatim(MANUAL_LOGS, MANUAL_LOGS_FAQ);
assertDefinedTerm(MANUAL_LOGS, "Transcription event", MANUAL_LOGS);
assertSerializable(MANUAL_LOGS);
assertNoEmDash(MANUAL_LOGS);

const REFINT = "/resources/verifying-reference-intervals";
assertArticle(REFINT);
assertFaqVerbatim(REFINT, REFINT_ARTICLE_FAQ);
assertHowTo(REFINT);
assertDefinedTerm(REFINT, "Reference Interval Verification", REFINT);
assertSerializable(REFINT);
assertNoEmDash(REFINT);

// Batch 5 additions. assertFaqVerbatim proves schema == source array. These two
// prove the other two links in the chain that a presence check would miss.
{
  const src = readFileSync(new URL("../client/src/pages/ArticleReferenceIntervalVerificationPage.tsx", import.meta.url), "utf8");

  // 1. RENDERED COUNT == SCHEMA COUNT, structurally rather than by counting JSX.
  //    faqContent.ts exists so the visible Q&A and the FAQPage node cannot drift,
  //    which is what Google's FAQ policy requires. A FAQPage node whose Q&A is not
  //    visible on the page is a policy violation, not a cosmetic gap. The page
  //    must therefore MAP the array; retyping the Q&A into JSX would satisfy a
  //    naive "is there a faq section" check while breaking the guarantee.
  check(`${REFINT}: page imports REFINT_ARTICLE_FAQ from the single source`,
    /import\s*\{[^}]*REFINT_ARTICLE_FAQ[^}]*\}\s*from\s*"@\/lib\/faqContent"/.test(src));
  check(`${REFINT}: page MAPS the array (does not retype the Q&A)`,
    /REFINT_ARTICLE_FAQ\.map\(/.test(src));
  check(`${REFINT}: renders a visible #faq section`, /id="faq"/.test(src));
  check(`${REFINT}: #faq is reachable from the Contents card`,
    /TocLink href="#faq"/.test(src));
  // Order matters: the spec puts FAQ before References.
  check(`${REFINT}: #faq precedes #references`,
    src.indexOf('id="faq"') > 0 && src.indexOf('id="faq"') < src.indexOf('id="references"'));

  // 2. articleBody ACTUALLY GREW. enrichArticleBodies() composes description + FAQ
  //    + HowTo, but only when the Article node has no articleBody already. If it
  //    silently fails to pick the FAQ up, the change is half-shipped and every
  //    other check here still passes.
  const bs = blocksFor(REFINT);
  const art = typeBlock(bs, "Article");
  const body: string = art?.articleBody || "";
  check(`${REFINT}: Article has an articleBody`, body.length > 0, `${body.length} chars`);
  const faqInBody = REFINT_ARTICLE_FAQ.every((qa) => body.includes(qa.q) && body.includes(qa.a));
  check(`${REFINT}: every FAQ Q&A composed into articleBody`, faqInBody, `${body.length} chars`);
  // Pre-batch-5 it was 425 chars (description + HowTo step names only).
  check(`${REFINT}: articleBody grew well past its 425-char pre-FAQ size`, body.length > 2000, `${body.length} chars`);
}

// Class sweep for the HowTo step-text drop. The per-route assertHowTo() calls
// above cover only the routes someone remembered to list: when the bug was found,
// 4 routes called it but only 1 of the 3 routes with a COMPOSED body was among
// them, so 2 of the 3 pages the fix repaired had no guard at all. Deriving the
// list from seoMetadataMap instead means a HowTo route added later is covered the
// day it lands, with nobody needing to remember this.
console.log("");
console.log("Class sweep: every Article+HowTo route keeps its step text");
{
  let swept = 0;
  for (const [route, meta] of Object.entries<any>(seoMetadataMap)) {
    const j = meta?.jsonLd;
    const bs: Block[] = !j ? [] : Array.isArray(j) ? j : [j];
    const art = bs.find((b) => b["@type"] === "Article");
    const ht = bs.find((b) => b["@type"] === "HowTo");
    if (!art || !ht || !Array.isArray(ht.step)) continue;
    const body: string = art.articleBody || "";
    const composed = ht.step.filter((s: any) => s?.name && body.includes(s.name));
    if (composed.length === 0) {
      // Hand-authored articleBody: enrichArticleBodies never ran on it, so its
      // HowTo text legitimately is not there. Reported, not failed: what goes in
      // an authored body is the author's call, not this script's.
      console.log(`      skip  ${route}  (hand-authored articleBody, ${body.length} chars)`);
      continue;
    }
    swept++;
    const dropped = composed.filter((s: any) => s?.text && !body.includes(s.text));
    check(`${route}: all ${composed.length} composed HowTo steps keep their text`, dropped.length === 0,
      dropped.length ? `${dropped.length} lost text` : `${body.length} char body`);
  }
  check(`sweep covered every composed HowTo route`, swept >= 3, `${swept} route(s) swept`);
}

console.log("");
console.log(`FAQ source counts: TEa=${TEA_ARTICLE_FAQ.length}, CalVer=${CALVER_ARTICLE_FAQ.length}, RefInt=${REFINT_ARTICLE_FAQ.length}, /faq=${flattenFaq(FAQ_CATEGORIES).length}`);
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
