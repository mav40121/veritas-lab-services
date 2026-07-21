// scripts/ping-indexnow.mts
// CLI trigger for IndexNow. Submit the URLs that actually changed after a content
// deploy so Bing / Yandex / Seznam / Naver / Yep re-crawl in hours. Do NOT ping the
// whole sitemap on every deploy (wasteful and rate-limit-prone); pass the specific
// changed URLs.
//
// Usage:
//   npx tsx scripts/ping-indexnow.mts <url> [<url> ...]    submit specific URLs
//   npx tsx scripts/ping-indexnow.mts --seed               submit the initial seed batch
//   npx tsx scripts/ping-indexnow.mts --seed --dry-run     print the payload, do not POST
//
// Gate 3 (after deploy): --seed returns HTTP 200/202 from api.indexnow.org, and
// https://<host>/<key>.txt returns the key (200, text/plain).

import {
  submitToIndexNow,
  INDEXNOW_HOST,
  INDEXNOW_KEY,
  INDEXNOW_KEY_LOCATION,
  INDEXNOW_ENDPOINT,
} from "../server/indexnow.ts";

const base = `https://${INDEXNOW_HOST}`;

// Recently-updated URLs from the SEO/GEO build (the spec's seed batch): the QC
// article, the 7 FAQ-schema resource pages, /pricing, and /calculator.
const SEED = [
  `${base}/resources/quality-control-testing-into-compliance`,
  `${base}/resources/clia-tea-lookup`,
  `${base}/resources/calibration-verification-requirements-clia`,
  `${base}/resources/how-to-perform-method-comparison-study`,
  `${base}/resources/precision-verification-report-interpretation-guide`,
  `${base}/resources/tjc-laboratory-inspection-what-to-expect`,
  `${base}/resources/cost-per-reportable-test-four-layer-framework`,
  `${base}/resources/manual-logs-why-most-labs-should-stop`,
  `${base}/pricing`,
  `${base}/calculator`,
];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const useSeed = args.includes("--seed");
const urls = useSeed ? SEED : args.filter((a) => a.startsWith("http"));

if (!urls.length) {
  console.error("No URLs. Usage: npx tsx scripts/ping-indexnow.mts <url...> | --seed [--dry-run]");
  process.exit(1);
}

console.log(`IndexNow endpoint : ${INDEXNOW_ENDPOINT}`);
console.log(`key               : ${INDEXNOW_KEY}`);
console.log(`keyLocation       : ${INDEXNOW_KEY_LOCATION}`);
console.log(`submitting ${urls.length} URL(s):`);
urls.forEach((u) => console.log("  " + u));

if (dryRun) {
  console.log("\n--dry-run: payload valid, not submitting.");
  process.exit(0);
}

try {
  const r = await submitToIndexNow(urls);
  console.log(`\nHTTP ${r.status} ${r.ok ? "OK/Accepted" : "(unexpected)"}  body: ${JSON.stringify(r.body)}`);
  process.exit(r.ok ? 0 : 1);
} catch (e) {
  console.error("IndexNow submit failed:", (e as Error).message);
  process.exit(1);
}
