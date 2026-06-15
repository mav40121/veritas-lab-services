// scripts/extract-faq-content.mjs
//
// GEO Item 1/3 (2026-06-15): generator for client/src/lib/faqContent.ts, the
// SINGLE SOURCE OF TRUTH for every visible FAQ on the marketing site. The
// three page components below render from these exact arrays, and the
// server-side SEO pipeline (server/seo-metadata.ts) builds FAQPage JSON-LD
// from the SAME arrays. Because both the rendered HTML and the structured
// data read one source, the schema can never drift from the visible Q&A
// (Google's FAQ policy + the honest-content rule require verbatim match).
//
// This generator extracts the array literals byte-for-byte from the current
// page sources so the initial faqContent.ts is identical to what was already
// published. After this runs once and the pages are refactored to import from
// faqContent.ts, faqContent.ts becomes the hand-edited source and this script
// is just provenance. Re-running it would overwrite faqContent.ts from the
// pages, so do not re-run after the refactor.
//
// Run: node scripts/extract-faq-content.mjs

import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Article FAQ arrays are inline in JSX as `{[ {q,a}, ... ].map(({ q, a }) => (`
function extractArticleFaq(file) {
  const s = read(file);
  const m = s.match(/Frequently Asked Questions<\/h2>[\s\S]*?\{(\[[\s\S]*?\])\.map\(\(\{ q, a \}\)/);
  if (!m) throw new Error("FAQ array not found in " + file);
  return m[1];
}

// /faq categories are a top-level `const FAQ_CATEGORIES = [ ... \n];`
function extractCategories(file) {
  const s = read(file);
  const m = s.match(/const FAQ_CATEGORIES = (\[[\s\S]*?\n\]);/);
  if (!m) throw new Error("FAQ_CATEGORIES not found in " + file);
  return m[1];
}

const tea = extractArticleFaq("client/src/pages/ArticleTeaPage.tsx");
const calver = extractArticleFaq("client/src/pages/ArticleCalVerPage.tsx");
const categories = extractCategories("client/src/pages/FAQPage.tsx");

const out = `// client/src/lib/faqContent.ts
//
// SINGLE SOURCE OF TRUTH for every visible FAQ on the marketing site.
// Rendered by the page components (ArticleTeaPage, ArticleCalVerPage, FAQPage)
// AND consumed by the server-side SEO pipeline (server/seo-metadata.ts) to
// build FAQPage JSON-LD. One source means the structured data can never drift
// from the visible Q&A, which Google's FAQ policy and the honest-content rule
// require. Edit the Q&A here; both the page and its schema update together.
//
// Generated initially by scripts/extract-faq-content.mjs from the page
// sources, then hand-edited here. Do NOT re-run the generator after the pages
// import from this file.

export interface FaqQA {
  q: string;
  a: string;
}

export interface FaqCategory {
  category: string;
  items: FaqQA[];
}

// /resources/clia-tea-what-lab-directors-dont-know  (visible "Frequently Asked Questions")
export const TEA_ARTICLE_FAQ: FaqQA[] = ${tea};

// /resources/clia-calibration-verification-method-comparison  (visible "Frequently Asked Questions")
export const CALVER_ARTICLE_FAQ: FaqQA[] = ${calver};

// /faq  (the main FAQ page, grouped by category)
export const FAQ_CATEGORIES: FaqCategory[] = ${categories};

// Flatten categories to a single Q&A list (for FAQPage JSON-LD mainEntity).
export function flattenFaq(categories: FaqCategory[]): FaqQA[] {
  return categories.flatMap((c) => c.items);
}
`;

const dest = path.join(ROOT, "client/src/lib/faqContent.ts");
fs.writeFileSync(dest, out, "utf8");
console.log("wrote", dest);
console.log("  TEA_ARTICLE_FAQ items:", (tea.match(/\bq:/g) || []).length);
console.log("  CALVER_ARTICLE_FAQ items:", (calver.match(/\bq:/g) || []).length);
console.log("  FAQ_CATEGORIES q count:", (categories.match(/\bq:/g) || []).length);
