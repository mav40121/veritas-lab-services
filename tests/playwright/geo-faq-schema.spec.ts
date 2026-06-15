// tests/playwright/geo-faq-schema.spec.ts
//
// Gate 3 receipt for GEO Item 1 (FAQPage JSON-LD) + Item 3 (DefinedTerm). The
// schema is server-injected into the raw HTML by the per-route SEO pipeline, so
// crawlers and AI answer engines see the Q&A and definitions BEFORE any JS runs.
// These assertions use the raw HTTP response (no browser JS) to prove exactly
// that: the structured data is in the bytes the bots fetch.
//
// Run: npx playwright test geo-faq-schema
//      PW_BASE=http://127.0.0.1:5099 npx playwright test geo-faq-schema

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

function countMatches(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

test.describe("GEO: FAQPage + DefinedTerm JSON-LD in raw HTML", () => {
  test("/faq carries one FAQPage with every question", async ({ request }) => {
    const html = await (await request.get(`${BASE}/faq`)).text();
    expect(html).toContain('"@type":"FAQPage"');
    // 63 visible Q&A across all categories at time of writing; assert it is
    // substantial and that a representative question is present verbatim.
    expect(countMatches(html, '"@type":"Question"')).toBeGreaterThanOrEqual(60);
    expect(html).toContain("What is VeritaAssure");
  });

  test("TEa article carries Article + FAQPage + DefinedTerm", async ({ request }) => {
    const html = await (await request.get(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`)).text();
    expect(html).toContain('"@type":"Article"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"DefinedTerm"');
    expect(html).toContain("CLIA Total Allowable Error (TEa)");
    // verbatim FAQ question
    expect(html).toContain("Does CLIA require labs to use CLIA TEa for calibration verification");
    expect(countMatches(html, '"@type":"Question"')).toBe(5);
  });

  test("Calibration Verification article carries FAQPage + DefinedTerm", async ({ request }) => {
    const html = await (await request.get(`${BASE}/resources/clia-calibration-verification-method-comparison`)).text();
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('"@type":"DefinedTerm"');
    expect(html).toContain("Calibration Verification");
    expect(html).toContain("Does calibration verification apply to waived tests");
    expect(countMatches(html, '"@type":"Question"')).toBe(6);
  });
});
