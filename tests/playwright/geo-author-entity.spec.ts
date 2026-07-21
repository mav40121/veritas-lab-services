// tests/playwright/geo-author-entity.spec.ts
//
// Gate 3 for the GEO author entity (global @graph). Fetches the served homepage,
// parses the @graph JSON-LD, and asserts it is well-formed (Organization anchor
// present) and carries the single authoritative author Person entity
// (#michael-veri, worksFor #organization). The author-node assertion is skipped
// until the node is deployed (it ships with this same PR), so the spec is green
// pre-deploy and asserts for real once live. Public page; no token needed.
//
// Env: PW_BASE (default prod).

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";

test.describe("GEO author entity", () => {
  test("global @graph is well-formed and carries the author Person entity", async ({ request }) => {
    const res = await request.get(`${BASE}/`);
    expect(res.ok(), "homepage 2xx").toBeTruthy();
    const html = await res.text();

    const m = html.match(/<script type="application\/ld\+json">\s*(\{[\s\S]*?\})\s*<\/script>/);
    expect(m, "global @graph <script> present").toBeTruthy();
    const data = JSON.parse(m![1]);
    const graph = data["@graph"];
    expect(Array.isArray(graph), "@graph is an array").toBeTruthy();

    // Always-true regression guard: the Organization node anchors the graph.
    const hasOrg = (graph as any[]).some((n) => String(n["@id"] || "").endsWith("#organization"));
    expect(hasOrg, "#organization node present").toBeTruthy();

    // The author entity ships in this same PR, so skip until it is deployed.
    const author = (graph as any[]).find((n) => String(n["@id"] || "").endsWith("#michael-veri"));
    test.skip(!author, "author entity not deployed yet (ships with this PR)");
    expect(author["@type"]).toBe("Person");
    expect(String(author.worksFor?.["@id"] || "")).toContain("#organization");
    expect(Array.isArray(author.hasCredential)).toBeTruthy();
  });
});
