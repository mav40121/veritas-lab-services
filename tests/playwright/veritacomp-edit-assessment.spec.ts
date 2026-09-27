// tests/playwright/veritacomp-edit-assessment.spec.ts
//
// Gate 3 step 8 for VeritaComp in-place assessment editing. Before this, a saved
// (unsigned) competency assessment was read-only: the evaluator could not add the
// specimen ID, observer, QC dates, or evaluator without deleting and recreating.
// This drives the new "Edit" button end to end on prod: open the pre-filled form,
// change Element 1's Specimen ID, save (PUT), reopen, and assert it persisted.
//
// Env-gated: PW_TOKEN (writer/LD on a VeritaComp lab) + PW_LAB_ID + PW_PROGRAM_ID
// (a technical program that has at least one UNSIGNED assessment). Skips otherwise.
//
//   PW_TOKEN=... PW_LAB_ID=3 PW_PROGRAM_ID=23 npx playwright test veritacomp-edit-assessment

import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN;
const LAB = process.env.PW_LAB_ID;
const PROGRAM = process.env.PW_PROGRAM_ID;

test.describe("VeritaComp: edit an unsigned assessment in place", () => {
  test.beforeEach(() => {
    test.skip(!TOKEN || !LAB || !PROGRAM, "Set PW_TOKEN, PW_LAB_ID, PW_PROGRAM_ID to run the edit-assessment check.");
  });

  test("Edit opens the pre-filled form and a saved specimen ID persists", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await injectAuth(page, BASE, TOKEN!);
    await page.goto(`${BASE}/labs/${LAB}/veritacomp-app/${PROGRAM}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Assessments tab (deep-link usually lands here; click it if present).
    const tab = page.getByRole("tab", { name: /assessments/i }).or(page.getByRole("button", { name: /^assessments$/i }));
    if (await tab.first().isVisible().catch(() => false)) await tab.first().click().catch(() => {});
    await page.waitForTimeout(1000);

    const editBtn = page.locator('[data-testid="edit-assessment"]').first();
    const hasEdit = await editBtn.isVisible().catch(() => false);
    test.skip(!hasEdit, "No unsigned assessment on this program to edit.");
    await editBtn.click();

    // Edit dialog opens pre-filled.
    await expect(page.getByText(/Edit .* Assessment/i).first()).toBeVisible({ timeout: 10000 });

    // Set a unique Specimen ID on Element 1 and save.
    const specimen = `PW-${Date.now().toString().slice(-6)}`;
    const specimenInput = page.getByPlaceholder("Specimen ID observed").first();
    await expect(specimenInput).toBeVisible({ timeout: 8000 });
    await specimenInput.fill(specimen);
    await page.getByRole("button", { name: /save assessment/i }).click();

    // Dialog closes on success (proves the save PUT succeeded in the browser,
    // i.e. no 413 on a large program and no error toast).
    await expect(page.getByText(/Edit .* Assessment/i).first()).toBeHidden({ timeout: 10000 });

    // Confirm the value round-tripped to the server. A large program has many
    // method-group tabs and the dialog auto-selects a "suggested" tab on reopen,
    // so a tab-dependent UI check is flaky; read the persisted item straight from
    // the API instead. The save above was driven entirely through the real UI.
    const persisted = await page.evaluate(async ([lab, program, sid]) => {
      const t = localStorage.getItem("veritas_token");
      const r = await fetch(`/api/labs/${lab}/competency/programs/${program}`, { headers: { Authorization: `Bearer ${t}` } });
      if (!r.ok) return false;
      const d = await r.json();
      for (const a of (d.assessments || [])) {
        for (const it of (a.items || [])) {
          if (it.el1_specimen_id === sid) return true;
        }
      }
      return false;
    }, [LAB, PROGRAM, specimen] as const);
    expect(persisted, `specimen ${specimen} persisted to an item`).toBeTruthy();

    expect(errors, `page errors: ${errors.join("; ")}`).toHaveLength(0);
    await ctx.close();
  });
});
