// tests/playwright/veritacomp-assessment-roster-employees.spec.ts
//
// Gate 3 step 8 for parking lot #59 (2026-10-07, Michael's Option 2): the
// "New Technical Assessment" dialog must offer the lab's VeritaStaff roster
// members who are assigned the program's instruments, instead of the dead-end
// "No active employees" notice. Authed + needs a program whose instrument has
// an assigned active staff member, so env-gated. Run live:
//   PW_TOKEN=... PW_LAB_ID=5 PW_PROGRAM_ID=12 PW_EXPECT_EMPLOYEE="Alecia Lillico-Perry" \
//     npx playwright test tests/playwright/veritacomp-assessment-roster-employees.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const PROGRAM_ID = process.env.PW_PROGRAM_ID || "";
const EXPECT = process.env.PW_EXPECT_EMPLOYEE || "";

test.describe("VeritaComp assessment dialog: roster employees by instrument", () => {
  test("dialog lists the assigned VeritaStaff employee and no dead-end notice", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID || !PROGRAM_ID || !EXPECT, "PW_TOKEN / PW_LAB_ID / PW_PROGRAM_ID / PW_EXPECT_EMPLOYEE not set, skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacomp-app/${PROGRAM_ID}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /New Assessment/i }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog, "assessment dialog opens").toBeVisible();

    const hint = dialog.getByTestId("assessment-roster-hint");
    await expect(hint, "roster hint appears (employees came from VeritaStaff)").toBeVisible();
    await expect(dialog.getByText("No active employees for this program"), "no dead-end notice").toHaveCount(0);

    const trigger = dialog.getByTestId("assessment-employee-select");
    await expect(trigger, "employee select defaults to the roster member").toContainText(EXPECT);
    await trigger.click();
    await expect(page.getByRole("option", { name: EXPECT }), "roster member is an option").toBeVisible();
  });
});
