// tests/playwright/veritamaintain-seat-gating.spec.ts
//
// Gate 3 step 8 evidence for making VeritaMaintain per-seat-gateable: equipment write
// routes are now requireModuleEdit('veritamaintain')-gated, and the module is grantable
// in seat permissions (SEAT_MODULE_KEYS + Account Settings MODULE_LIST). Source
// invariants (browser QA is blocked on prod); a live check is gated on PW_BASE.

import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const BASE = process.env.PW_BASE || "";
const TOKEN = process.env.PW_TOKEN || "";
const LAB = process.env.PW_LAB_ID || "";

test.describe("VeritaMaintain per-seat gating", () => {
  test("source: veritamaintain is grantable AND equipment writes are gated", () => {
    const root = process.cwd();
    const schema = readFileSync(join(root, "shared/schema.ts"), "utf8");
    const settings = readFileSync(join(root, "client/src/pages/AccountSettingsPage.tsx"), "utf8");
    const routes = readFileSync(join(root, "server/routes.ts"), "utf8");

    expect(schema).toMatch(/SEAT_MODULE_KEYS[\s\S]*'veritamaintain'/);
    expect(settings).toMatch(/key:\s*'veritamaintain'/);
    // All five equipment write routes carry the module-edit gate.
    const gated = (routes.match(/app\.(?:post|put|delete)\("\/api\/labs\/:labId\/equipment[^"]*", authMiddleware, labScopeMiddleware, requireWriteAccess, requireModuleEdit\('veritamaintain'\)/g) || []).length;
    expect(gated).toBeGreaterThanOrEqual(5);
  });

  test("live: an owner/admin can still write equipment (gate does not over-block)", async () => {
    if (!BASE || !TOKEN || !LAB) { test.skip(true, "Needs PW_BASE + PW_TOKEN (owner/admin) + PW_LAB_ID."); return; }
    const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Authorization: `Bearer ${TOKEN}`, "X-Active-Lab-Id": LAB } });
    // Empty body -> handler validation (400), NOT a 403 from the gate.
    const r = await ctx.post(`/api/labs/${LAB}/equipment`, { data: {} });
    expect(r.status()).not.toBe(403);
    await ctx.dispose();
  });
});
