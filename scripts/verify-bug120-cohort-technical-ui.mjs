// scripts/verify-bug120-cohort-technical-ui.mjs
// Browser receipt for BUG-120 (Michael Q91 = 1, 2026-11-02): the Cohort Sign-off dialog offers waived and non-technical
// programs only, with a note that technical competencies are signed on each person's page. Made-up lab and programs on a
// scratch DB only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-bug120-cohort-technical-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, p, body, token) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { return await r.json(); } catch { return {}; }
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const email = `bug120-ui-${Date.now()}@example.com`;
const owner = await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Bug120 UI", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Cohort UI Lab", plan: "hospital" })).labId;
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Cohort UI Lab", cliaNumber: "11D7654385", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const tech = await call("POST", `${L}/competency/programs`, { name: "Hematology Competency", department: "Hematology", type: "technical" }, owner.token);
const waived = await call("POST", `${L}/competency/programs`, { name: "Waived Glucose", department: "Point of Care", type: "waived" }, owner.token);
const nonTech = await call("POST", `${L}/competency/programs`, { name: "Safety", department: "General", type: "nontechnical", checklistItems: [{ description: "Fire extinguisher location" }] }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
const uid = sdb.prepare("SELECT id FROM users WHERE email = ?").get(email).id;
sdb.prepare("UPDATE users SET has_completed_onboarding = 1 WHERE id = ?").run(uid);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
check("setup: technical, waived and non-technical programs", !!tech?.id && !!waived?.id && !!nonTech?.id);

const browser = await chromium.launch();
for (const scheme of ["light", "dark"]) {
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [owner.token, owner.user]);
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" });
  if (scheme === "dark") await page.evaluate(() => document.documentElement.classList.add("dark"));
  await page.getByRole("button", { name: "Cohort Sign-off" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Step 1. Shared fields").waitFor({ timeout: 10000 });
  await dialog.locator("select").first().locator("option", { hasText: "Safety" }).waitFor({ state: "attached", timeout: 10000 });
  const options = await dialog.locator("select").first().locator("option").allInnerTexts();
  const note = await dialog.getByTestId("cohort-technical-note").innerText();
  if (scheme === "light") {
    check("the program list offers the waived and non-technical programs and not the technical one",
      options.includes("Waived Glucose") && options.includes("Safety") && !options.includes("Hematology Competency"), options.join(" | "));
    check("the note says technical competencies are signed on each person's page", /Technical competencies are signed on each person's page/.test(note), note);
  }
  await dialog.getByText("Step 1. Shared fields").locator("..").screenshot({ path: path.join(OUT, `bug120-cohort-${scheme}.png`) });
  check(`${scheme} mode: dialog renders with the note`, await dialog.getByTestId("cohort-technical-note").isVisible());
  await page.close();
}
await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
