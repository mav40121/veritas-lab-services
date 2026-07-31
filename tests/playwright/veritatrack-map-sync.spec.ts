// tests/playwright/veritatrack-map-sync.spec.ts
//
// Gate 3 for the VeritaTrack -> VeritaMap sign-off sync fix (SCAHC report
// 2026-07-29: the map showed a cal ver as "not done" after a sign-off). The
// unit logic is covered by scripts/verify-veritatrack-map-sync.mts; this proves
// the live endpoint returns the new `map_sync` contract so the client can stop
// failing silently. It drives the real sign-off endpoint against a THROWAWAY
// task whose map_analyte cannot match any real map row, so no customer map data
// is touched, and soft-deletes the task in a finally.
//
// Needs creds: PW_TOKEN. Skips cleanly without it.
// Run: PW_TOKEN=... npx playwright test veritatrack-map-sync

import { test, expect } from "@playwright/test";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";

test.describe("VeritaTrack map-sync sign-off contract", () => {
  test("a linked sign-off that matches no map row reports map_sync.warning instead of silence", async ({ request }) => {
    test.skip(!TOKEN, "PW_TOKEN required");
    const auth = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
    let taskId: number | null = null;
    try {
      // Throwaway task linked to an analyte that cannot exist on any real map.
      const created = await request.post(`${BASE}/api/veritatrack/tasks`, {
        headers: auth,
        data: {
          name: "__pw map-sync spec (safe to delete)__",
          category: "Other",
          frequency: "Annual",
          map_analyte: "__pw_nonexistent_analyte__",
          map_field: "last_cal_ver",
        },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      const task = await created.json();
      taskId = task.id;
      // The link must survive creation.
      expect(task.map_analyte).toBe("__pw_nonexistent_analyte__");
      expect(task.map_field).toBe("last_cal_ver");

      const signoff = await request.post(`${BASE}/api/veritatrack/tasks/${taskId}/signoff`, {
        headers: auth,
        data: { completed_date: "2026-07-29", performed_by: "PW map-sync spec" },
      });
      expect(signoff.ok(), await signoff.text()).toBeTruthy();
      const body = await signoff.json();

      // The core of the fix: a 0-row write-back is reported, not swallowed.
      expect(body.map_sync, "signoff response carries map_sync").toBeTruthy();
      expect(body.map_sync.linked).toBe(true);
      expect(body.map_sync.updated).toBe(0);
      expect(typeof body.map_sync.warning).toBe("string");
      expect(body.map_sync.warning.length).toBeGreaterThan(0);
    } finally {
      if (taskId != null) {
        await request.delete(`${BASE}/api/veritatrack/tasks/${taskId}`, { headers: auth });
      }
    }
  });
});
