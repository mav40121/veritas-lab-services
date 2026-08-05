// tests/playwright/clinic-plan-access.spec.ts
//
// Gate 3 evidence for the clinic-tier access fix. The Clinic plan's DB string is
// `clinic`, but most module gates were written around `waived` (the tier's
// legacy name) and never had `clinic` added, so clinic labs (e.g. Troy) were
// locked out of VeritaLab / VeritaPolicy / VeritaStock / VeritaTrack / VeritaQC.
// This asserts a clinic-plan user reaches a previously-broken module without the
// upgrade/plan gate.
//
// Gated behind PW_CLINIC_TOKEN (a session on a clinic-plan lab); compile-only in
// CI. Live confirmation: a clinic lab opens the modules and sees content, not an
// upgrade wall.

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const CLINIC_TOKEN = process.env.PW_CLINIC_TOKEN || "";
const LAB = process.env.PW_CLINIC_LAB || ""; // e.g. /labs/17

const MODULES = ["/veritalab-app", "/veritapolicy-app", "/veritastock", "/veritatrack-app", "/veritaqc-app"];

test.describe("Clinic plan has full module access", () => {
  test("clinic-plan user is not upgrade-gated out of the suite modules", async ({ page }) => {
    if (!CLINIC_TOKEN || !LAB) { test.skip(true, "Set PW_CLINIC_TOKEN + PW_CLINIC_LAB (a clinic-plan lab)."); return; }
    await injectAuth(page, BASE, CLINIC_TOKEN);
    for (const m of MODULES) {
      await page.goto(`${BASE}${LAB}${m}`, { waitUntil: "networkidle" });
      // The plan gate renders an upgrade prompt; a clinic lab must not see it.
      await expect(page.getByText(/upgrade your plan|not included in your plan|plan does not include/i), `module ${m}`).toHaveCount(0);
    }
  });
});
