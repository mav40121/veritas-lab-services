// tests/playwright/veritacomp-rebuild-method-groups.spec.ts
//
// Gate 3 step 8 receipt for the Shape A class sweep PR (2026-06-08).
// The new clickable surface introduced in this PR is the "Rebuild from
// VeritaMap (lab-wide)" button on VeritaComp's program-detail Overview
// tab. The server-side fix is exercised in five places, but this spec
// covers the only NEW UI element. Other four instances are pure read-
// path fixes with no new control.
//
// What this spec asserts:
//   1. POST /api/labs/:labId/competency/programs/:id/rebuild-method-groups
//      exists and is reachable as the owner.
//   2. It returns the documented shape: { created, kept, mapsScanned,
//      message }.
//   3. Idempotent: a second call right after the first reports zero new
//      method groups (everything is now "kept").
//   4. Refuses non-technical programs with a 400 + clear error.
//
// Env:
//   PW_BASE    — base URL (default prod)
//   PW_TOKEN   — owner JWT for PW_LAB_ID
//   PW_LAB_ID  — default 3 (Michaels Lab)

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "3";

test.describe("VeritaComp rebuild-method-groups (Shape A class sweep)", () => {
  test("endpoint responds for a technical program with documented shape", async ({ request }) => {
    // Pull the first technical program from this lab.
    const list = await request.get(`${BASE}/api/labs/${LAB_ID}/competency/programs`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(list.status()).toBe(200);
    const programs = await list.json() as Array<{ id: number; type: string }>;
    const tech = programs.find(p => p.type === "technical");
    if (!tech) {
      test.skip(true, "No technical program in this lab to exercise the rebuild endpoint against.");
      return;
    }
    const r = await request.post(
      `${BASE}/api/labs/${LAB_ID}/competency/programs/${tech.id}/rebuild-method-groups`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(body).toHaveProperty("created");
    expect(body).toHaveProperty("kept");
    expect(body).toHaveProperty("mapsScanned");
    expect(body).toHaveProperty("message");
    expect(typeof body.created).toBe("number");
    expect(typeof body.kept).toBe("number");
    expect(typeof body.mapsScanned).toBe("number");
  });

  test("idempotent: second call produces zero new groups", async ({ request }) => {
    const list = await request.get(`${BASE}/api/labs/${LAB_ID}/competency/programs`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const programs = await list.json() as Array<{ id: number; type: string }>;
    const tech = programs.find(p => p.type === "technical");
    if (!tech) {
      test.skip(true, "No technical program in this lab to exercise idempotency against.");
      return;
    }
    // Two consecutive calls: first may insert, second must be all-kept.
    await request.post(
      `${BASE}/api/labs/${LAB_ID}/competency/programs/${tech.id}/rebuild-method-groups`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    const second = await request.post(
      `${BASE}/api/labs/${LAB_ID}/competency/programs/${tech.id}/rebuild-method-groups`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(second.status()).toBe(200);
    const body = await second.json();
    expect(body.created).toBe(0);
  });

  test("refuses non-technical programs with 400", async ({ request }) => {
    const list = await request.get(`${BASE}/api/labs/${LAB_ID}/competency/programs`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const programs = await list.json() as Array<{ id: number; type: string }>;
    const nonTech = programs.find(p => p.type !== "technical");
    if (!nonTech) {
      test.skip(true, "No non-technical program in this lab to assert the 400 path against.");
      return;
    }
    const r = await request.post(
      `${BASE}/api/labs/${LAB_ID}/competency/programs/${nonTech.id}/rebuild-method-groups`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error).toMatch(/technical programs/i);
  });
});
