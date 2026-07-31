// tests/playwright/veritamap-instrument-tag.spec.ts
//
// Gate 3 for the VeritaMap Build Tests instrument distinguisher (COPC / Michael
// Longstreth feedback 2026-07-29: with duplicate analyzers, the model name
// alone forced trial-and-error when copying a backup). The header and the
// Copy-From dropdown now show the instrument's assigned nickname / serial.
//
// Deterministic + safe: sets a temporary nickname on the first instrument of a
// map via the API, loads the Build page, asserts the nickname renders, then
// reverts the nickname in a finally. Env-gated on PW_TOKEN + PW_LAB_ID +
// PW_MAP_ID; skips cleanly in CI.
// Run: PW_TOKEN=... PW_LAB_ID=16 PW_MAP_ID=79 npx playwright test veritamap-instrument-tag

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const MAP_ID = process.env.PW_MAP_ID || "";
const TAG = "PWTAG-BACKUP-2";

test.describe("VeritaMap Build: instrument name/serial distinguisher", () => {
  test("assigned nickname shows next to the model on the Build page", async ({ page, request }) => {
    test.skip(!TOKEN || !LAB_ID || !MAP_ID, "PW_TOKEN + PW_LAB_ID + PW_MAP_ID required");
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
    const mapUrl = `${BASE}/api/labs/${LAB_ID}/veritamap/maps/${MAP_ID}`;

    const mapRes = await request.get(mapUrl, { headers: auth });
    expect(mapRes.ok(), await mapRes.text()).toBeTruthy();
    const map = await mapRes.json();
    const instruments = (map.instruments || map.instrument_list || []) as any[];
    test.skip(!Array.isArray(instruments) || instruments.length === 0, "map has no instruments to tag");
    const inst = instruments[0];
    const original = inst.nickname ?? null;

    const putBody = (nickname: string | null) => ({
      instrument_name: inst.instrument_name,
      role: inst.role,
      category: inst.category,
      serial_number: inst.serial_number ?? null,
      nickname,
    });

    try {
      const put = await request.put(`${mapUrl}/instruments/${inst.id}`, { headers: auth, data: putBody(TAG) });
      expect(put.ok(), await put.text()).toBeTruthy();

      await injectAuth(page, BASE, TOKEN);
      await page.goto(`${BASE}/labs/${LAB_ID}/veritamap-app/${MAP_ID}/build`);
      // The distinguisher renders as "· <nickname>" next to the model in the header.
      await expect(page.getByText(TAG, { exact: false }).first()).toBeVisible({ timeout: 20000 });
    } finally {
      await request.put(`${mapUrl}/instruments/${inst.id}`, { headers: auth, data: putBody(original) });
    }
  });
});
