// tests/playwright/veritapolicy-multilab-status-isolation.spec.ts
//
// Gate 3 guard for the VeritaPolicy multi-lab data-loss fix (audit HIGH #1/#2).
// veritapolicy_master_status was keyed UNIQUE(user_id, policy_id) while the
// lab-scoped route reads WHERE lab_id, so a multi-lab OWNER marking a policy in
// one lab silently overwrote and re-attributed the other lab's row. After the
// Phase 3.3 re-key (UNIQUE(lab_id, policy_id)) each lab keeps its own status.
//
// This drives the authenticated lab-scoped API as a MULTI-LAB owner: set policy
// "1" to different statuses in two labs, then read both back and assert they are
// independent. It uses the verilabguy test account (owns Michaels Lab + Riverside
// Regional, no real policy data), and RESTORES the original status of each lab
// afterward. Needs PW_TOKEN (multi-lab owner JWT); compile-only in CI otherwise.
//
// Env: PW_BASE (default production www), PW_TOKEN (multi-lab owner JWT).

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const POLICY_ID = "1";

test.describe("VeritaPolicy multi-lab status isolation (Phase 3.3 re-key)", () => {
  test("policy status set in lab A does not overwrite or re-attribute lab B", async ({ page }) => {
    if (!TOKEN) {
      test.skip(true, "No PW_TOKEN provided (compile-only gate run).");
      return;
    }
    await injectAuth(page, BASE, TOKEN);

    const api = async (method: string, path: string, body?: any) =>
      page.evaluate(async ([m, p, b, base]) => {
        const res = await fetch(`${base}${p}`, {
          method: m as string,
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: b ? JSON.stringify(b) : undefined,
        });
        let json: any = null;
        try { json = await res.json(); } catch {}
        return { status: res.status, json };
      }, [method, path, body, BASE] as const);

    // Discover >= 2 owned labs.
    const me = await api("GET", "/api/labs/me");
    const labIds: number[] = Array.isArray(me.json)
      ? me.json.filter((m: any) => m.role === "owner").map((m: any) => m.labId)
      : [];
    if (labIds.length < 2) {
      test.skip(true, "PW_TOKEN owner has < 2 labs; cannot prove isolation.");
      return;
    }
    const [labA, labB] = labIds;

    const getStatus = async (labId: number) => {
      const r = await api("GET", `/api/labs/${labId}/veritapolicy/master-list`);
      const row = (r.json?.rows || []).find((x: any) => String(x.policy_id) === POLICY_ID);
      return row?.status ?? "not_started";
    };
    const setStatus = (labId: number, status: string) =>
      api("PATCH", `/api/labs/${labId}/veritapolicy/master-list/${POLICY_ID}`, { status });

    const origA = await getStatus(labA);
    const origB = await getStatus(labB);
    try {
      await setStatus(labA, "complete");
      await setStatus(labB, "in_progress");
      // The core assertion: lab A kept "complete" (was NOT overwritten by lab B's write).
      expect(await getStatus(labA)).toBe("complete");
      expect(await getStatus(labB)).toBe("in_progress");
    } finally {
      // Restore original statuses so the test is non-destructive on prod.
      await setStatus(labA, origA);
      await setStatus(labB, origB);
    }
  });
});
