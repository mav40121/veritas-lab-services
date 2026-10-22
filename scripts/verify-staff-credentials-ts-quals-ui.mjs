// scripts/verify-staff-credentials-ts-quals-ui.mjs
// Gate 3 browser receipt (Angie Cedeno 2026-10-21): in VeritaStaff Add Employee, (1) one person holds several
// credentials (her example: BS/BA + MLT(ASCP) + MT(AMT)), (2) ASCPi credentials are offered, (3) a custom credential
// can be typed, (4) TS minimum qualifications follow the specialties picked and include bachelor's + 4 years for
// chemistry and microbiology. Also exercises the legacy branch: a single keyword-backfilled title opens as one chip
// with its stored title kept, and a custom entry typed but not yet added is still saved.
// LOCAL server + scratch DB only. Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-staff-credentials-ts-quals-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return await r.json(); } catch { return {}; } };
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const flat = (s) => (s || "").replace(/\s+/g, " ").trim();
const stamp = Date.now();
const ownerEmail = `cred-owner-${stamp}@example.com`;
const owner = await call("POST", "/api/auth/register", { email: ownerEmail, password: "Testpass123", name: "Cred Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Credential Test Lab", plan: "hospital" })).labId;
await call("POST", `/api/labs/${labId}/staff/lab`, { labName: "Credential Test Lab", cliaNumber: "11D7654351", accreditationBody: "CLIA_ONLY", complexity: "high" }, owner.token);
const legacy = await call("POST", `/api/labs/${labId}/staff/employees`, { lastName: "Legacy", firstName: "Lee", title: "Medical Laboratory Scientist", titleCode: "MLS_ASCP", highestComplexity: "H", performsTesting: true, roles: [] }, owner.token);
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(ownerEmail);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
sdb.close();
check("fixture: high complexity lab with a legacy single-title employee", !!labId && !!owner.token && !!(legacy.id || legacy.employee?.id), JSON.stringify(legacy).slice(0, 120));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/`);
const me = await page.evaluate(async ([b, tk]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } }); return r.ok ? r.json() : null; }, [BASE, owner.token]);
await page.evaluate(([tk, u, lab]) => { localStorage.setItem("veritas_token", tk); if (u) localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(lab)); localStorage.setItem("theme", "light"); }, [owner.token, me, labId]);
await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });

// ── Add Employee: Angie's example + ASCPi + custom ─────────────────────
await page.getByRole("button", { name: /Add Employee/ }).first().click();
const dlg = page.getByRole("dialog");
await dlg.waitFor();
const inputs = dlg.locator("input");
await inputs.nth(0).fill("Cedeno");
await inputs.nth(1).fill("Test");
const pick = async (label) => { await dlg.getByTestId("credential-add").click(); await page.getByRole("option", { name: label, exact: true }).click(); await page.waitForTimeout(150); };
await pick("MT(AMT)");
await pick("BS / BA");
await pick("MLT(ASCP)");
await dlg.getByTestId("credential-add").click();
const ascpiOptions = await page.getByRole("option", { name: /\(ASCPi\)$/ }).allInnerTexts();
check("the picker offers ASCPi credentials", ascpiOptions.length >= 2 && ascpiOptions.includes("MLS(ASCPi)"), ascpiOptions.join(", "));
await page.getByRole("option", { name: "MLS(ASCPi)", exact: true }).click();
await dlg.getByTestId("credential-custom-input").fill("NY State CLT License");
await dlg.getByTestId("credential-custom-add").click();
const chips = (await dlg.getByTestId("credential-chip").allInnerTexts()).map((c) => flat(c).replace(/\s*×$/, ""));
check("five chips in fixed order: degree, ASCP, ASCPi, AMT, custom", chips.join(" | ") === "BS / BA | MLT(ASCP) | MLS(ASCPi) | MT(AMT) | NY State CLT License", chips.join(" | "));
await dlg.getByTestId("employee-credentials").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/cred_chips_light.png` });
await dlg.getByRole("button", { name: "TS", exact: true }).click();
const tsBefore = flat(await dlg.getByTestId("clia-qual-reminder").innerText());
check("TS with no specialty picked asks for the specialties", /Pick the TS specialties below/.test(tsBefore), tsBefore.slice(0, 160));
await dlg.getByRole("button", { name: "7. Chemistry" }).click();
await dlg.getByRole("button", { name: "1. Bacteriology" }).click();
const tsLines = flat(await dlg.getByTestId("ts-specialty-quals").innerText());
check("TS chemistry line includes bachelor's degree with 4 years, 493.1449(d)", /Diagnostic immunology, chemistry.*bachelor's degree with 4 years\. 42 CFR §493\.1449\(d\)/.test(tsLines), tsLines.slice(0, 400));
check("TS microbiology line includes bachelor's + 4 years and 6 months in the subspecialty, 493.1449(c)", /Microbiology:.*bachelor's degree with 4 years\. Every experience route needs 6 months in the subspecialty\. 42 CFR §493\.1449\(c\)/.test(tsLines), tsLines.slice(0, 400));
await dlg.getByTestId("clia-qual-reminder").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/cred_add_dialog_light.png` });
await dlg.getByRole("button", { name: /^Add Employee$/ }).click();
await page.waitForTimeout(2000);
let db = new Database(process.env.SCRATCH_DB, { readonly: true });
const saved = db.prepare("SELECT title, title_code FROM staff_employees WHERE tier2_lab_id = ? AND last_name = 'Cedeno'").get(labId);
db.close();
check("saved: title is the joined display string, title_code the joined codes + OTHER", saved?.title === "BS / BA, MLT(ASCP), MLS(ASCPi), MT(AMT), NY State CLT License" && saved?.title_code === "BS_BA,MLT_ASCP,MLS_ASCPI,MT_AMT,OTHER", JSON.stringify(saved));
await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
const card = flat((await page.getByTestId("staff-employee-card").allInnerTexts()).find((c) => /Cedeno/.test(c)));
check("roster card shows all credentials", /BS \/ BA, MLT\(ASCP\), MLS\(ASCPi\), MT\(AMT\), NY State CLT License/.test(card), card.slice(0, 160));

// ── Re-open for edit: chips come back from the stored fields ────────────
await page.getByTestId("staff-employee-card").filter({ hasText: "Cedeno" }).click();
await page.getByRole("button", { name: /Edit/ }).first().click();
await page.getByRole("dialog").waitFor();
const chips2 = (await page.getByRole("dialog").getByTestId("credential-chip").allInnerTexts()).map((c) => flat(c).replace(/\s*×$/, ""));
check("edit dialog re-opens with the same five chips", chips2.join(" | ") === chips.join(" | "), chips2.join(" | "));
await page.keyboard.press("Escape");

// ── Legacy row: one chip, stored title kept; typed-not-added custom still saves ──
await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
await page.getByTestId("staff-employee-card").filter({ hasText: "Legacy" }).click();
await page.getByRole("button", { name: /Edit/ }).first().click();
const dlg3 = page.getByRole("dialog");
await dlg3.waitFor();
const chips3 = (await dlg3.getByTestId("credential-chip").allInnerTexts()).map((c) => flat(c).replace(/\s*×$/, ""));
const note = flat(await dlg3.getByTestId("credential-legacy-title").innerText().catch(() => ""));
check("legacy row: one MLS(ASCP) chip and a note that the roster still shows the stored title", chips3.join() === "MLS(ASCP)" && /Medical Laboratory Scientist/.test(note), `${chips3.join()} / ${note}`);
await dlg3.getByTestId("credential-custom-input").fill("PBT(ASCP)");
await dlg3.getByRole("button", { name: /Update Employee/ }).click();
await page.waitForTimeout(2000);
db = new Database(process.env.SCRATCH_DB, { readonly: true });
const legacySaved = db.prepare("SELECT title, title_code FROM staff_employees WHERE tier2_lab_id = ? AND last_name = 'Legacy'").get(labId);
db.close();
check("a custom entry typed but not added is still saved", legacySaved?.title === "MLS(ASCP), PBT(ASCP)" && legacySaved?.title_code === "MLS_ASCP,OTHER", JSON.stringify(legacySaved));

// ── Dark mode look at the Add dialog ─────────────────────────────────────
await page.emulateMedia({ colorScheme: "dark" }); // ThemeProvider follows prefers-color-scheme
await page.goto(`${BASE}/labs/${labId}/veritastaff-app`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Add Employee/ }).first().click();
const dlg4 = page.getByRole("dialog");
await dlg4.waitFor();
await dlg4.getByTestId("credential-add").click();
await page.getByRole("option", { name: "MLT(ASCP)", exact: true }).click();
await dlg4.getByTestId("credential-custom-input").fill("MT(AMT) legacy");
await dlg4.getByTestId("credential-custom-add").click();
await dlg4.getByRole("button", { name: "TS", exact: true }).click();
await dlg4.getByRole("button", { name: "8. Hematology" }).click();
check("dark mode is on for the dark captures", await page.evaluate(() => document.documentElement.classList.contains("dark")));
await dlg4.getByTestId("employee-credentials").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/cred_chips_dark.png` });
await dlg4.getByTestId("clia-qual-reminder").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/cred_add_dialog_dark.png` });
await browser.close();
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
