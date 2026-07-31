#!/usr/bin/env node
/**
 * verify-active-lab-header.js
 *
 * Receipt for the un-prefixed-page fallback fix (2026-07-31) in
 * client/src/lib/auth.ts authHeaders():
 *
 *   X-Active-Lab-Id = getActiveLabIdFromUrl() ?? getPersistedActiveLabId()
 *
 * The client now attaches the active-lab header even when the URL has no
 * /labs/:id prefix, using the lab the user last SWITCHED to (persisted to
 * localStorage by LabSwitcher). This stops un-prefixed authenticated pages
 * from letting the server resolve a possibly-stale default lab. The URL always
 * wins when present; the persisted value is only a fallback.
 *
 * This mirrors the resolution as pure logic and asserts the precedence.
 */

// Faithful copy of the auth.ts resolution (pure form).
function resolveHeaderLabId(urlPath, persistedRaw) {
  const fromUrl = (() => {
    const m = String(urlPath || "").match(/^\/labs\/(\d+)(?:\/|$)/);
    return m ? Number(m[1]) : null;
  })();
  const fromPersisted = (() => {
    const v = Number(persistedRaw);
    return Number.isFinite(v) && v > 0 ? v : null;
  })();
  const labId = fromUrl ?? fromPersisted;
  // authHeaders only sets the header when labId is truthy (>0).
  return labId && labId > 0 ? labId : null;
}

const cases = [
  { name: "URL prefix wins over persisted", url: "/labs/14/dashboard", persisted: "3", expect: 14 },
  { name: "persisted used on an un-prefixed page", url: "/account/settings", persisted: "6", expect: 6 },
  { name: "persisted used on a public page (logged-in)", url: "/pricing", persisted: "6", expect: 6 },
  { name: "no URL, no persisted -> no header (server default)", url: "/dashboard", persisted: null, expect: null },
  { name: "un-prefixed with garbage persisted -> no header", url: "/dashboard", persisted: "not-a-number", expect: null },
  { name: "un-prefixed with 0 persisted -> no header", url: "/dashboard", persisted: "0", expect: null },
  { name: "deep-link to a lab overrides a different persisted", url: "/labs/8/veritacheck", persisted: "3", expect: 8 },
  { name: "root path, persisted present", url: "/", persisted: "5", expect: 5 },
];

let failures = 0;
for (const c of cases) {
  const got = resolveHeaderLabId(c.url, c.persisted);
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
console.log("All active-lab header precedence cases passed.");
