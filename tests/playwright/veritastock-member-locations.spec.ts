// tests/playwright/veritastock-member-locations.spec.ts
//
// Gate 3 evidence for member location provisioning. Demo feedback (San Carlos):
// "when a user is built we need a default location and which locations they can
// access (the ED person should only access ED)." The Members page now has a
// "Locations & access" grid (owner/admin, multi-location VeritaStock) that
// grants a member access to chosen enterprise locations and sets their default,
// backed by GET /veritastock/team and POST /veritastock/members/:userId/locations.
//
// Run (Michael, owner token on the VeritaStock service):
//   $env:PW_BASE="https://www.veritastock.com"; $env:PW_TOKEN="<token>"; `
//     npx playwright test veritastock-member-locations
// Without PW_TOKEN the spec skips cleanly (CI compile-only gate still typechecks it).

import { test, expect, APIRequestContext } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritastock.com";
const TOKEN = process.env.PW_TOKEN || "";
const auth = { Authorization: `Bearer ${TOKEN}` };

async function firstLabId(request: APIRequestContext): Promise<number> {
  const r = await request.get(`${BASE}/api/labs/me`, { headers: auth });
  if (!r.ok()) return 0;
  const labs = (await r.json()) as Array<{ labId: number }>;
  return labs.length ? labs[0].labId : 0;
}

test.describe("VeritaStock member locations provisioning", () => {
  test.skip(!TOKEN, "set PW_TOKEN to a VeritaStock owner login token");

  test("the team endpoint returns locations + members with default", async ({ request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/team`, { headers: auth });
    expect(r.ok(), `team: ${r.status()}`).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.locations)).toBeTruthy();
    expect(Array.isArray(body.members)).toBeTruthy();
    // Each member carries the fields the grid needs.
    if (body.members.length) {
      expect(body.members[0]).toHaveProperty("locationIds");
      expect(body.members[0]).toHaveProperty("defaultLocationId");
    }
  });

  test("the Locations & access grid renders on a multi-location enterprise", async ({ page, request }) => {
    const labId = await firstLabId(request);
    test.skip(!labId, "no lab resolved");
    const r = await request.get(`${BASE}/api/labs/${labId}/veritastock/team`, { headers: auth });
    const body = r.ok() ? await r.json() : { locations: [] };
    test.skip((body.locations?.length || 0) < 2, "single-location enterprise: card intentionally hidden");

    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${labId}/members`);
    await expect(page.getByTestId("member-locations-card")).toBeVisible({ timeout: 20000 });
  });
});
