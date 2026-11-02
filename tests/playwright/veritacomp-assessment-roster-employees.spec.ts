// tests/playwright/veritacomp-assessment-roster-employees.spec.ts
//
// Gate 3 step 8 for parking lot #59 (2026-10-07, Michael's Option 2), updated for BUG-118 (Michael Q90 = 1,
// 2026-11-02): a technical program's New Assessment opens "Record on the person's page", which must offer the lab's
// VeritaStaff roster members assigned the program's instruments (the same people the retired form offered, from
// eligible-employees), never a dead end; picking one opens that person's competency page. Read-only: nothing is saved.
// Authed + needs a technical program whose instrument has an assigned active staff member, so env-gated. Run live:
//   PW_TOKEN=... PW_LAB_ID=5 PW_PROGRAM_ID=12 PW_EXPECT_EMPLOYEE="Alecia Lillico-Perry" \
//     npx playwright test tests/playwright/veritacomp-assessment-roster-employees.spec.ts
import { test, expect } from "@playwright/test";
import { injectAuth } from "./_auth";

const BASE = process.env.PW_BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.PW_TOKEN || "";
const LAB_ID = process.env.PW_LAB_ID || "";
const PROGRAM_ID = process.env.PW_PROGRAM_ID || "";
const EXPECT = process.env.PW_EXPECT_EMPLOYEE || "";

test.describe("VeritaComp technical New Assessment: roster employees, then the person's page", () => {
  test("the person picker lists the assigned VeritaStaff employee, and picking opens their page", async ({ page }) => {
    test.skip(!TOKEN || !LAB_ID || !PROGRAM_ID || !EXPECT, "PW_TOKEN / PW_LAB_ID / PW_PROGRAM_ID / PW_EXPECT_EMPLOYEE not set, skipping authed exercise");
    await injectAuth(page, BASE, TOKEN);
    await page.goto(`${BASE}/labs/${LAB_ID}/veritacomp-app/${PROGRAM_ID}`, { waitUntil: "networkidle" });

    await page.getByRole("button", { name: /New Assessment/i }).first().click();
    const picker = page.getByTestId("technical-person-picker");
    await expect(picker, "the person picker opens (not the whole-record form)").toBeVisible();
    await expect(picker.getByTestId("technical-person-picker-empty"), "no dead end").toHaveCount(0);

    const person = picker.getByRole("button", { name: new RegExp(EXPECT) }).first();
    await expect(person, "the roster member is offered").toBeVisible();
    await person.click();
    await page.waitForURL(new RegExp(`/labs/${LAB_ID}/veritacomp-app/employee/\\d+$`), { timeout: 15000 });
    await expect(page.getByText(EXPECT).first(), "the person's competency page opens").toBeVisible();
  });
});
