#!/usr/bin/env node
/**
 * verify-lab-resolution-precedence.js
 *
 * Receipt for the cross-lab convergence fix (2026-07-31): the 7 server sites
 * that used to resolve the active lab from the Referer URL only now go through
 * a single helper, activeLabIdFromContext(req), with this precedence:
 *
 *   path scope  >  ?labId query  >  X-Active-Lab-Id header  >  Referer URL
 *
 * The point of the fix: the client attaches X-Active-Lab-Id on every request
 * from a /labs/:id page, and it is not subject to referrer-policy stripping,
 * so lab resolution no longer silently falls back to the user's DEFAULT lab
 * when Referer is absent. Referer stays only as a last-ditch fallback.
 *
 * This mirrors the production helper as pure logic and asserts the precedence,
 * including the decisive case: header present, Referer pointing at a DIFFERENT
 * (stale) lab -> the header wins.
 */

// Faithful copy of server/routes.ts activeLabIdFromContext (pure form).
function activeLabIdFromContext(req) {
  const pos = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const scoped = pos(req?.scope?.labId); if (scoped) return scoped;
  const q = pos(req?.query?.labId); if (q) return q;
  const hdr = pos(req?.headers?.["x-active-lab-id"]); if (hdr) return hdr;
  const ref = req?.headers?.referer;
  if (ref) {
    const m = String(ref).match(/\/labs\/(\d+)\//);
    if (m) { const r = pos(m[1]); if (r) return r; }
  }
  return null;
}

const R = (over = {}) => ({ scope: undefined, query: {}, headers: {}, ...over });

const cases = [
  {
    name: "header beats a STALE Referer (the core fix)",
    req: R({ headers: { "x-active-lab-id": "14", referer: "https://app/labs/3/account/settings" } }),
    expect: 14,
  },
  {
    name: "Referer used only when header is absent",
    req: R({ headers: { referer: "https://app/labs/3/dashboard" } }),
    expect: 3,
  },
  {
    name: "header used when Referer is stripped (referrer-policy)",
    req: R({ headers: { "x-active-lab-id": "6" } }),
    expect: 6,
  },
  {
    name: "explicit ?labId beats header",
    req: R({ query: { labId: "9" }, headers: { "x-active-lab-id": "14" } }),
    expect: 9,
  },
  {
    name: "path scope beats everything",
    req: R({ scope: { labId: 2 }, query: { labId: "9" }, headers: { "x-active-lab-id": "14", referer: "https://app/labs/3/x" } }),
    expect: 2,
  },
  {
    name: "no context at all -> null (caller keeps its own default fallback)",
    req: R({ headers: { referer: "https://app/dashboard" } }),
    expect: null,
  },
  {
    name: "garbage header ignored, falls through to Referer",
    req: R({ headers: { "x-active-lab-id": "not-a-number", referer: "https://app/labs/5/x" } }),
    expect: 5,
  },
  {
    name: "zero/negative labId rejected (pos guard)",
    req: R({ headers: { "x-active-lab-id": "0", referer: "https://app/labs/7/x" } }),
    expect: 7,
  },
];

let failures = 0;
for (const c of cases) {
  const got = activeLabIdFromContext(c.req);
  if (got === c.expect) {
    console.log(`PASS  ${c.name}  -> ${got}`);
  } else {
    failures++;
    console.log(`FAIL  ${c.name}  expected=${c.expect} got=${got}`);
  }
}

console.log(`\n${cases.length - failures}/${cases.length} cases passed.`);
if (failures > 0) {
  console.error(`${failures} case(s) FAILED.`);
  process.exit(1);
}
console.log("All lab-resolution precedence cases passed.");
