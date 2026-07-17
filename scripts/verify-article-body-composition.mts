// scripts/verify-article-body-composition.mts
//
// Receipt for making enrichArticleBodies() ADDITIVE (batch 6).
//
// Before: `if (!article || article.articleBody) continue` skipped any Article that
// already had an articleBody, so a hand-authored body suppressed composition
// entirely and its page's FAQ never reached the body signal.
//
// After: an authored body SEEDS the composition and the FAQ/HowTo append after it.
// The pass may only ADD text, never remove or replace it.
//
// The assertion that matters is a FLOOR, not a delta. A "did it grow?" test passes
// happily while quietly truncating a route that had nothing to append. So the core
// case here drives the real function over synthetic maps with known inputs and
// asserts the authored text survives byte-for-byte in every branch.
//
// Run: npx tsx scripts/verify-article-body-composition.mts

import { enrichArticleBodies, seoMetadataMap } from "../server/seo-metadata";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const AUTHORED = "Authored verbatim page text that must never be discarded.";
const DESC = "Short meta description.";
const Q = "Does this question survive?";
const A = "Yes, appended after the authored seed.";
const STEP_NAME = "Step label";
const STEP_TEXT = "Step instruction text.";

function makeArticle(opts: { authored?: boolean; faq?: boolean; howto?: boolean }) {
  const blocks: any[] = [
    {
      "@type": "Article",
      description: DESC,
      ...(opts.authored ? { articleBody: AUTHORED } : {}),
    },
  ];
  if (opts.faq) {
    blocks.push({ "@type": "FAQPage", mainEntity: [{ name: Q, acceptedAnswer: { text: A } }] });
  }
  if (opts.howto) {
    blocks.push({ "@type": "HowTo", step: [{ name: STEP_NAME, text: STEP_TEXT }] });
  }
  return { "/x": { title: "t", description: DESC, jsonLd: blocks } } as any;
}
const bodyOf = (m: any) => m["/x"].jsonLd.find((b: any) => b["@type"] === "Article").articleBody as string;

console.log("\nCase 1: authored + FAQ -> authored is PRESERVED, FIRST, and the FAQ appends");
{
  const m = makeArticle({ authored: true, faq: true });
  enrichArticleBodies(m);
  const b = bodyOf(m);
  check("authored text still present", b.includes(AUTHORED));
  check("authored text is FIRST", b.startsWith(AUTHORED));
  check("FAQ question appended", b.includes(Q));
  check("FAQ answer appended", b.includes(A));
  check("body GREW past the authored seed", b.length > AUTHORED.length, `${AUTHORED.length} -> ${b.length}`);
  // The old behaviour: authored body suppressed composition entirely.
  check("this is the batch-6 gain (old code left it at the authored length)", b.length > AUTHORED.length);
}

console.log("\nCase 2: authored + NO FAQ + NO HowTo -> byte-identical, the anti-gutting case");
{
  // This is the case that killed the deletion proposal. Four live routes are in
  // this shape; composing from description alone would cut them 83-90%.
  const m = makeArticle({ authored: true });
  enrichArticleBodies(m);
  check("body is byte-identical to the authored text", bodyOf(m) === AUTHORED, `${bodyOf(m).length} chars`);
  check("description did NOT replace the authored body", !bodyOf(m).includes(DESC));
}

console.log("\nCase 3: NO authored + FAQ -> seeds from description, behaviour unchanged");
{
  const m = makeArticle({ faq: true, howto: true });
  enrichArticleBodies(m);
  const b = bodyOf(m);
  check("seeds from description when nothing is authored", b.startsWith(DESC));
  check("FAQ appended", b.includes(Q) && b.includes(A));
  check("HowTo step name appended", b.includes(STEP_NAME));
  check("HowTo step TEXT appended (the earlier name||text fix)", b.includes(STEP_TEXT));
}

console.log("\nCase 4: IDEMPOTENCY. The old short-circuit was silently doing this job.");
{
  // `if (article.articleBody) continue` made the pass idempotent as a side effect:
  // after one run every composed node has a body, so a second run no-ops. The seed
  // removes that, and without the WeakSet a second call would seed from its own
  // output and append the FAQ AGAIN. One call site today, so not a live bug; it
  // becomes one the moment anything invokes this twice.
  const m = makeArticle({ authored: true, faq: true, howto: true });
  enrichArticleBodies(m);
  const first = bodyOf(m);
  enrichArticleBodies(m);
  const second = bodyOf(m);
  check("second call changes nothing", first === second, `${first.length} -> ${second.length}`);
  const qCount = second.split(Q).length - 1;
  check("FAQ question appears exactly ONCE after two calls", qCount === 1, `appeared ${qCount}x`);
  const aCount = second.split(AUTHORED).length - 1;
  check("authored seed appears exactly ONCE after two calls", aCount === 1, `appeared ${aCount}x`);
  // Third call, because doubling would compound.
  enrichArticleBodies(m);
  check("third call still changes nothing", bodyOf(m) === first);
}

console.log("\nCase 5: the live map. No authored body was discarded.");
{
  // The four routes with no FAQ and no HowTo, whose authored bodies deletion would
  // have gutted. Byte lengths are the ones measured live before this change.
  const FLOOR: Record<string, number> = {
    "/resources/how-to-validate-veritacheck-clia": 923,
    "/resources/why-veritacheck-vs-legacy-verification": 1003,
    "/resources/laboratory-inventory-management": 1016,
    "/resources/how-veritaassure-trains-lab-leaders": 1450,
  };
  for (const [route, expected] of Object.entries(FLOOR)) {
    const meta: any = (seoMetadataMap as any)[route];
    const bs = Array.isArray(meta?.jsonLd) ? meta.jsonLd : meta?.jsonLd ? [meta.jsonLd] : [];
    const art = bs.find((b: any) => b?.["@type"] === "Article");
    const len = (art?.articleBody || "").length;
    check(`${route}: unchanged at ${expected} chars`, len === expected, `got ${len}`);
  }

  // Nothing anywhere may end up shorter than its own description, which is the
  // weakest possible composition. A route below that floor means something replaced
  // rather than appended.
  let below = 0;
  for (const [route, meta] of Object.entries<any>(seoMetadataMap)) {
    const bs = Array.isArray(meta.jsonLd) ? meta.jsonLd : meta.jsonLd ? [meta.jsonLd] : [];
    const art = bs.find((b: any) => b?.["@type"] === "Article");
    if (!art?.articleBody) continue;
    if (art.articleBody.length < (art.description || "").length) {
      below++;
      console.log(`      ${route}: body ${art.articleBody.length} < description ${art.description.length}`);
    }
  }
  check("no article's body is shorter than its own description", below === 0, `${below} below floor`);
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
