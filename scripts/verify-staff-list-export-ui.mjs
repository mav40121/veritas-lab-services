// scripts/verify-staff-list-export-ui.mjs
//
// Browser receipt (Gate 3 step 8) for VeritaStaff's "Download staff list" (Heywood 2026-11-13: "Other than the C209
// form is there any way to print an employee list"). On a local production build with a scratch DB and a made-up
// owner, lab and roster, written through the app's own routes, never production:
//   B1. the Staff tab shows "Download staff list" beside Generate CMS 209; clicking it downloads
//       VeritaStaff_Staff_List_<date>.xlsx, which opens on About and lists exactly the active roster, last name first,
//       with each tester's Competency the same as the badge on that person's card
//   B2. a Staff login limited to their own record doesn't see the button
//   B3. phone width: the toolbar wraps, no sideways scroll, the button is on screen
//   B4. dark mode: the button's label reads at 4.5:1 or better
// The downloaded workbook is saved to OUT for a print check. Screenshots go to OUT.
// Run: PW_BASE=http://localhost:5253 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-staff-list-export-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Staff", "List", "88!"].join("-");
const stamp = Date.now();
const now = new Date().toISOString();

let LAB = 0;
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(token && LAB ? { "X-Active-Lab-Id": String(LAB) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const register = async (tag, name) => {
  const email = `stafflist-ui-${tag}-${stamp}@example.com`;
  const reg = await call("POST", "/api/auth/register", { email, password: pw, name, hipaa_acknowledged: true });
  const id = Number(sql("SELECT id FROM users WHERE email = ?", email)?.id);
  sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", id);
  return { email, token: reg.body.token, id };
};

const OWNER = await register("owner", "Made-up Owner Pell");
LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Gardner Lab", plan: "hospital" })).body.labId;
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790015', time_zone = 'America/New_York' WHERE id = ?", LAB);
const L = `/api/labs/${LAB}`;
await call("POST", `${L}/staff/lab`, { labName: "Made-up Gardner Lab", cliaNumber: "22D7790015", accreditationBody: "CLIA_ONLY", complexity: "high" }, OWNER.token);
const person = async (body) => Number((await call("POST", `${L}/staff/employees`, body, OWNER.token)).body.id);
const P = {
  zulu: await person({ lastName: "Zulu", firstName: "Amy", title: "MLS", highestComplexity: "H", performsTesting: true, hireDate: "2020-01-15", roles: [{ role: "TP" }] }),
  adams: await person({ lastName: "Adams", firstName: "Ben", middleInitial: "M", title: "Lead MLS", highestComplexity: "M", performsTesting: true, hireDate: "2018-06-01", roles: [{ role: "TC", specialtyNumber: 8 }, { role: "TP" }] }),
  clark: await person({ lastName: "Clark", firstName: "Cy", title: "Supervisor", highestComplexity: "W", performsTesting: false, hireDate: "2015-02-02", roles: [{ role: "GS" }] }),
  gone: await person({ lastName: "Gone", firstName: "Dee", highestComplexity: "M", performsTesting: true, hireDate: "2019-09-09" }),
};
sql("UPDATE staff_employees SET status = 'inactive' WHERE id = ?", P.gone);
const sixtyAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
sql("UPDATE staff_competency_schedules SET initial_completed_at = ? WHERE employee_id = ?", sixtyAgo, P.adams);
// A Staff login tied to Zulu's roster row (limited to their own record).
const STAFF = await register("staff", "Made-up Amy Zulu");
sql(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`, LAB, STAFF.id, now, now, now);
sql(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`,
  OWNER.id, STAFF.email, STAFF.id, now, now, `stafflist-ui-${stamp}`, LAB, P.zulu);
check("setup: a made-up owner, lab, 4 roster rows (1 inactive) and a Staff login", LAB > 0 && Object.values(P).every((x) => x > 0) && STAFF.id > 0, JSON.stringify({ LAB, P }));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; return page.goto(url, opts); } };
const openAs = async (who, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1600, height: 950 }, colorScheme: opts.colorScheme || "light", acceptDownloads: true });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, who.token]);
  await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.token, me, LAB]);
  await go(page, `${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const contrast = async (page, locator) => page.evaluate((el) => {
  const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 4).map(Number);
  const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const fg = rgb(getComputedStyle(el).color);
  let n = el, bg = null;
  while (n) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0.5)) { bg = c; break; } n = n.parentElement; }
  bg = bg || [255, 255, 255];
  const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}, await locator.elementHandle());

try {
  // B1. Owner downloads.
  const page = await openAs(OWNER, `/labs/${LAB}/veritastaff-app`);
  const btn = page.getByTestId("button-download-staff-list");
  await btn.waitFor({ timeout: 20000 });
  await page.getByTestId("staff-employee-card").first().waitFor({ timeout: 20000 });
  const toolbar = await btn.locator("xpath=..").innerText();
  check("B1a. the button sits in the toolbar with Generate CMS 209", toolbar.includes("Download staff list") && toolbar.includes("Generate CMS 209"), toolbar.replace(/\s+/g, " "));
  check("B1b. the button is enabled", await btn.isEnabled());
  await page.screenshot({ path: `${OUT}/staff-list-button-light.png`, fullPage: false });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), btn.click()]);
  const fname = dl.suggestedFilename();
  check("B1c. it downloads VeritaStaff_Staff_List_<date>.xlsx", /^VeritaStaff_Staff_List_\d{4}-\d{2}-\d{2}\.xlsx$/.test(fname), fname);
  const saved = `${OUT}/${fname}`;
  await dl.saveAs(saved);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(saved);
  check("B1d. the workbook has About then Staff List, opening on About", wb.worksheets.map((w) => w.name).join("|") === "About|Staff List" && wb.views?.[0]?.activeTab === 0);
  const ws = wb.getWorksheet("Staff List");
  const rows = [];
  ws.eachRow((row, n) => { if (n > 1) rows.push([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => row.getCell(i).text)); });
  check("B1e. exactly the active roster, last name then first", rows.map((r) => r[0]).join(",") === "Adams,Clark,Zulu", rows.map((r) => r[0]).join(","));
  // Each tester's Competency is the badge on that person's card.
  const cards = await page.getByTestId("staff-employee-card").allInnerTexts();
  for (const r of rows.filter((x) => x[6] === "Yes")) {
    const card = cards.find((c) => c.includes(`${r[0]}, ${r[1]}`)) || "";
    check(`B1f. ${r[0]}: Competency "${r[7]}" is the badge on the card`, r[7] !== "" && card.includes(r[7]), card.replace(/\s+/g, " ").slice(0, 160));
  }
  check("B1g. Clark (doesn't test) has blank competency columns", rows.find((r) => r[0] === "Clark")?.slice(7, 9).join("") === "");

  // B2. A Staff login limited to their own record.
  const staffPage = await openAs(STAFF, `/labs/${LAB}/veritastaff-app`);
  await staffPage.waitForTimeout(1500);
  await staffPage.waitForLoadState("networkidle");
  check("B2. a Staff login limited to their own record doesn't see the button", (await staffPage.getByTestId("button-download-staff-list").count()) === 0);
  await staffPage.screenshot({ path: `${OUT}/staff-list-staff-login.png`, fullPage: false });

  // B3. Phone.
  const phone = await openAs(OWNER, `/labs/${LAB}/veritastaff-app`, { viewport: { width: 375, height: 812 } });
  const pbtn = phone.getByTestId("button-download-staff-list");
  await pbtn.waitFor({ timeout: 20000 });
  const sideways = await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const box = await pbtn.boundingBox();
  check("B3. phone width: no sideways scroll and the button is on screen", sideways <= 1 && !!box && box.x >= 0 && box.x + box.width <= 376, `sideways=${sideways} box=${JSON.stringify(box)}`);
  await phone.screenshot({ path: `${OUT}/staff-list-phone.png`, fullPage: false });

  // B4. Dark.
  const dark = await openAs(OWNER, `/labs/${LAB}/veritastaff-app`, { colorScheme: "dark" });
  const dbtn = dark.getByTestId("button-download-staff-list");
  await dbtn.waitFor({ timeout: 20000 });
  const ratio = await contrast(dark, dbtn);
  check("B4. dark mode: the button label reads at 4.5:1 or better", ratio >= 4.5, ratio.toFixed(2));
  await dark.screenshot({ path: `${OUT}/staff-list-button-dark.png`, fullPage: false });
} finally {
  await browser.close();
}
console.log(`${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
