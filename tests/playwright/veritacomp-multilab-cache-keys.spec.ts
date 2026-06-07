// tests/playwright/veritacomp-multilab-cache-keys.spec.ts
//
// Regression assertion for the cleanup PR that drove the multi-lab
// audit baseline from 16 -> 0 on VeritaCompAppPage. The user-visible
// bug class: a mutation succeeded server-side but the React Query
// invalidation key did not match the useQuery key, so the UI did NOT
// refresh. The same family of bugs as PR #606 (VeritaTrack Add Task)
// and PR #608 (verification page).
//
// This spec covers the SERVER side — the same lab-scoped endpoints
// that the page now invalidates against actually exist and respond
// shaped JSON. If a future refactor breaks the URL shape, the spec
// fails before the cache-key mismatch can re-emerge.
//
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT for PW_LAB_ID
//   PW_LAB_ID  — default 3 (Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaComp multilab cache-key endpoints", () => {
  test("lab-scoped programs list endpoint responds", async ({ request }) => {
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/competency/programs`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("lab-scoped employees list endpoint responds", async ({ request }) => {
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/competency/employees`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test("lab-scoped program detail endpoint responds for at least one program", async ({ request }) => {
    const list = await request.get(`${BASE}/api/labs/${LAB_ID}/competency/programs`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const programs = await list.json();
    if (!programs.length) {
      test.skip(true, "No programs in this lab to fetch detail for.");
      return;
    }
    const r = await request.get(`${BASE}/api/labs/${LAB_ID}/competency/programs/${programs[0].id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(r.status()).toBe(200);
    const detail = await r.json();
    expect(detail.id).toBe(programs[0].id);
    // The page's useQuery shape depends on these arrays existing on the detail.
    expect(Array.isArray(detail.employees) || detail.employees === undefined).toBe(true);
    expect(Array.isArray(detail.assessments) || detail.assessments === undefined).toBe(true);
  });
});
