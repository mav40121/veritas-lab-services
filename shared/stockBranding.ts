// shared/stockBranding.ts
//
// Everything that turns the shared index.html into the VeritaStock deployment.
//
// This lives in one exported, side-effect-free function so the de-lab rule is
// TESTABLE. The rule for veritastock.com is that "lab", "laboratory" and
// "compliance" must not appear at all, not even negated. That is a property of
// the RENDERED page, not of any one constant, so a test has to be able to run
// the real transform over the real index.html and look at the output. Before
// this, the transform was inline in getIndexHtml() and a test could only
// re-implement it, which proves the re-implementation and nothing else.
//
// History: the title and meta rewrites here already existed inline. The ld+json
// swap is new (2026-07-17). client/index.html carries one @graph describing the
// VeritaAssure suite, in <head>, so it was served on veritastock.com too: 26
// occurrences of "laboratory"/"compliance" reaching crawlers there via the
// Organization name, the ProfessionalService node, and the per-product
// descriptions. Found by fetching www.veritastock.com as Googlebot.

export const STOCK_TITLE = "VeritaStock™ | Multi-Location Inventory Management";

export const STOCK_DESC =
  "Multi-location supply inventory: burn-rate par levels, lead-time-aware reorder alerts, expiration tracking, valuation by location, and one-click vendor orders.";

export const STOCK_KEYWORDS =
  "VeritaStock, multi-location inventory management, supply inventory software, par level management, reorder point alerts, expiration date tracking, lead-time verification, vendor purchase orders, barcode inventory, materials management";

// The graph served on veritastock.com. A REPLACEMENT for the suite graph, not a
// filter over it: filtering leaves dangling isPartOf/publisher @id references
// pointing at nodes that no longer exist on this host.
//
// Deliberately NO Organization node. Schema Organization wants a legal name,
// and the standing rule is to ask before printing "Veritas Lab Services, LLC"
// on customer-facing VeritaStock collateral. Omitting states nothing false and
// prints nothing. Adding one with an invented name would do both. If this host
// should carry an Organization, the name is Michael's call.
export const STOCK_JSON_LD_GRAPH = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "SoftwareApplication",
      "@id": "https://www.veritastock.com/#veritastock",
      name: "VeritaStock",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: STOCK_DESC,
      url: "https://www.veritastock.com",
      featureList: [
        "Multi-location supply inventory with per-location counts",
        "Burn-rate par levels calculated from actual consumption",
        "Lead-time-aware reorder point alerts",
        "Expiration date tracking with advance warning",
        "Inventory valuation by location",
        "One-click vendor purchase orders",
        "Barcode scanning and a shared counting station",
        "Location-to-location transfers with accept and reject at the destination",
        "Append-only adjustment audit trail with signature capture",
        "Holds no patient information",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://www.veritastock.com/#website",
      url: "https://www.veritastock.com",
      name: "VeritaStock",
      description:
        "Multi-location supply inventory and spend visibility: par levels, reorder alerts, expiration tracking, and vendor orders.",
    },
  ],
};

export const LD_JSON_RE = /<script type="application\/ld\+json">[\s\S]*?<\/script>/;

export const STOCK_JSON_LD_SCRIPT =
  `<script type="application/ld+json">\n${JSON.stringify(STOCK_JSON_LD_GRAPH, null, 2)}\n    </script>`;

/**
 * Rewrite the shared index.html into its VeritaStock form: title, meta, and the
 * JSON-LD graph. Pure. Given the same html it returns the same html.
 */
export function applyStockBranding(html: string): string {
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${STOCK_TITLE}</title>`)
    .replace(/<meta name="description" content="[^"]*"/, `<meta name="description" content="${STOCK_DESC}"`)
    .replace(/<meta name="keywords" content="[^"]*"/, `<meta name="keywords" content="${STOCK_KEYWORDS}"`)
    .replace(/<meta property="og:title" content="[^"]*"/, `<meta property="og:title" content="${STOCK_TITLE}"`)
    .replace(/<meta property="og:description" content="[^"]*"/, `<meta property="og:description" content="${STOCK_DESC}"`)
    // NOTE: this prints the legal name on VeritaStock collateral, which the
    // standing rule says to ask about first. Preserved EXACTLY as it shipped:
    // this module is an extract of existing behavior plus the graph swap, and a
    // refactor that quietly changes a second thing is how regressions get in.
    // Flagged separately rather than fixed here.
    .replace(/<meta property="og:site_name" content="[^"]*"/, `<meta property="og:site_name" content="VeritaStock | Veritas Lab Services"`)
    .replace(/<meta name="twitter:title" content="[^"]*"/, `<meta name="twitter:title" content="${STOCK_TITLE}"`)
    .replace(/<meta name="twitter:description" content="[^"]*"/, `<meta name="twitter:description" content="${STOCK_DESC}"`)
    .replace(LD_JSON_RE, STOCK_JSON_LD_SCRIPT);
}
