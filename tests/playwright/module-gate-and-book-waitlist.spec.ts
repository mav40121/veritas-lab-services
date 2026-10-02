// tests/playwright/module-gate-and-book-waitlist.spec.ts
//
// Gate 3 step 8 evidence for the correction-pass fixes:
//   1. The book waitlist form posts to a REAL endpoint (/api/newsletter/subscribe),
//      not the non-existent /api/notify that silently dropped the emails.
//   2. VeritaOps is grantable in seat permissions (it is gated by
//      requireModuleEdit('veritaops'), so it must appear in the account-settings
//      module list or custom-permission seats are permanently locked out).
//
// Source invariants always run (browser QA is blocked on prod). The live check of
// the subscribe endpoint is gated on PW_BASE and skips cleanly without it.

import { test, expect, request as pwRequest } from "@playwright/test";
import { readFileSync } from "fs";
import { join } from "path";

const BASE = process.env.PW_BASE || "";

test.describe("Correction pass: book waitlist endpoint + VeritaOps seat gate", () => {
  test("source: book waitlist posts to /api/newsletter/subscribe, not /api/notify", () => {
    const book = readFileSync(join(process.cwd(), "client/src/pages/BookPage.tsx"), "utf8");
    expect(book).toContain('fetch("/api/newsletter/subscribe"');
    expect(book).not.toContain('fetch("/api/notify"');
  });

  test("source: veritaops is grantable (gated AND in both seat lists)", () => {
    const root = process.cwd();
    const schema = readFileSync(join(root, "shared/schema.ts"), "utf8");
    const settings = readFileSync(join(root, "client/src/pages/AccountSettingsPage.tsx"), "utf8");
    // Gated somewhere on the server.
    let gated = false;
    for (const f of ["veritaops.ts", "routes.ts"]) {
      try { if (/requireModuleEdit\(\s*['"]veritaops['"]\s*\)/.test(readFileSync(join(root, "server", f), "utf8"))) gated = true; } catch { /* file may not exist */ }
    }
    expect(gated).toBeTruthy();
    expect(schema).toMatch(/SEAT_MODULE_KEYS[\s\S]*'veritaops'/);
    expect(settings).toMatch(/key:\s*'veritaops'/);
  });

  test("live: /api/newsletter/subscribe accepts a book-source signup", async () => {
    if (!BASE) { test.skip(true, "Needs PW_BASE."); return; }
    const ctx = await pwRequest.newContext({ baseURL: BASE });
    const r = await ctx.post("/api/newsletter/subscribe", {
      data: { email: `pw-book-${Date.now()}@example.com`, source: "book" },
    });
    expect(r.ok()).toBeTruthy();
    expect((await r.json()).success).toBeTruthy();
    await ctx.dispose();
  });
});
