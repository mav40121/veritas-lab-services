// scripts/verify-access-report-ui.mjs
// Gate 3 browser receipt for record-view logging and the access report (server/recordViews.ts; Lifepoint IPS
// III.1(i); Michael Q27 = 1, 2026-10-25). Run against a LOCAL server on a scratch database (it registers accounts and
// provisions a lab, so never point it at production):
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-access-report-ui.mjs
// Light: a staff member opens the lab dashboard in the browser (it reads studies, coverage, competency and staff data); the owner's Members page shows the Access report with
// those reads, filters to that person, and downloads the Excel (About sheet first, Access Log rows). Dark: card renders.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {};
  try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const stamp = Date.now();
const pw = (tag) => ["Ar", String(stamp).slice(-5), tag].join("-") + "!"; // throwaway, scratch database only
const ownerEmail = `access-ui-owner-${stamp}@example.com`, memberEmail = `access-ui-member-${stamp}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email: ownerEmail, password: pw("o"), name: "Access Owner", hipaa_acknowledged: true })).body;
const member = (await call("POST", "/api/auth/register", { email: memberEmail, password: pw("m"), name: "Riley Reader", hipaa_acknowledged: true })).body;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: "Access Lab", plan: "hospital" })).body.labId;
await call("POST", "/api/admin/create-lab-invite", { secret: ADMIN, labId, email: memberEmail, role: "staff" });
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email IN (?, ?)").run(ownerEmail, memberEmail);
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);
check("scratch accounts and lab", !!owner.token && !!member.token && labId > 0);

const browser = await chromium.launch();
async function signedIn(token, user, mode = "light") {
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, acceptDownloads: true });
  await page.goto(`${BASE}/`);
  await page.evaluate(([tk, u, m]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem("theme", m); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [token, user, mode]);
  return page;
}

// 1) The member opens the lab dashboard in the browser.
{
  const page = await signedIn(member.token, member.user);
  await page.goto(`${BASE}/labs/${labId}/dashboard`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.close();
  const n = sdb.prepare("SELECT COUNT(*) AS n FROM record_views WHERE lab_id = ? AND user_id = ?").get(labId, member.user.id).n;
  const mods = sdb.prepare("SELECT DISTINCT module FROM record_views WHERE lab_id = ? AND user_id = ?").all(labId, member.user.id).map((r) => r.module);
  check("1. the member's dashboard reads are logged with their modules", n >= 3 && mods.includes("VeritaCheck"), `rows=${n} modules=${mods.join(",")}`);
}

// 2) The owner's Members page: Access report, filter, download.
{
  const page = await signedIn(owner.token, owner.user);
  await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  const card = page.getByTestId("access-report-card");
  await card.waitFor({ timeout: 20000 });
  const text = (await card.innerText()).replace(/\s+/g, " ");
  check("2a. the Access report lists the member's reads", /Access report/.test(text) && /Riley Reader/.test(text) && /record views?/.test(text), text.slice(0, 260));
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/access_report_card_light.png` });
  const memberId = String(member.user.id);
  await page.getByTestId("access-person").selectOption(memberId);
  await page.waitForTimeout(1200);
  const people = await page.locator('[data-testid="access-rows"] tbody tr td:nth-child(2)').allInnerTexts();
  check("2b. filtering by person shows only that person", people.length >= 1 && people.every((t) => /Riley Reader/.test(t)), JSON.stringify(people.slice(0, 5)));
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByTestId("access-download").click()]);
  const file = `${OUT}/${dl.suggestedFilename()}`;
  await dl.saveAs(file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const names = wb.worksheets.map((w) => w.name);
  const logRows = (wb.getWorksheet("Access Log")?.rowCount || 1) - 1;
  const about = String(wb.getWorksheet("About")?.getCell("A2").value || "");
  check("2c. the Excel download opens with About first, lab identity, and the member's rows", names[0] === "About" && /Access Lab/.test(about) && logRows >= 1, `${dl.suggestedFilename()} sheets=${names.join(",")} rows=${logRows}`);
  const audited = sdb.prepare("SELECT 1 FROM audit_log WHERE entity_type = 'access_report.download' AND user_id = ?").get(owner.user.id);
  check("2d. the download is in the audit trail", !!audited);
  await page.close();
  const dark = await signedIn(owner.token, owner.user, "dark");
  await dark.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  await dark.evaluate(() => document.documentElement.classList.add("dark"));
  const dcard = dark.getByTestId("access-report-card");
  await dcard.waitFor({ timeout: 20000 });
  await dcard.scrollIntoViewIfNeeded();
  await dcard.screenshot({ path: `${OUT}/access_report_card_dark.png` });
  check("2e. dark: the card renders", true);
  await dark.close();
}

// 3) The staff member does not see the card.
{
  const page = await signedIn(member.token, member.user);
  await page.goto(`${BASE}/labs/${labId}/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  check("3. a staff member does not get the Access report card", (await page.getByTestId("access-report-card").count()) === 0);
  await page.close();
}

await browser.close();
sdb.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
