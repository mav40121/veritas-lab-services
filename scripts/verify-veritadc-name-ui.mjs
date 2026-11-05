// scripts/verify-veritadc-name-ui.mjs
// Gate 3 receipt for the VeritaDC name in server outputs (site review 2026-11-05). Run against a LOCAL server on a scratch database, with made-up
// people (it registers an owner and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritadc-name-ui.mjs
// In a real browser: the VeritaDC how-to card says VeritaDC; Master List (Excel) and All Starters (ZIP) download under the new name; the workbook's
// About sheet and page header say VeritaDC. "Formerly VeritaPolicy" stays on the public module card, because it tells readers about the rename.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const ExcelJS = require("exceljs");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("This check registers a made-up owner, so it runs on a local server only.");
const PW = ["Dc", "name", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};

const email = `dc-name-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "DC Name Lab", plan: "hospital" })).labId;
const sdb = new Database(process.env.SCRATCH_DB);
sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email);
if (labId) sdb.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999999' WHERE id = ?").run(labId);
sdb.close();
check("made-up owner and lab created", !!reg.token && !!labId);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/`);
const user = await call("GET", "/api/auth/me", null, reg.token);
await page.evaluate(([t, u, id]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${id}`, "1"); }, [reg.token, user, user.id]);
await page.goto(`${BASE}/veritapolicy-app`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Master List (Excel)" }).waitFor({ timeout: 20000 });
const text = await page.locator("body").innerText();
check("how-to card says VeritaDC", text.includes("Author or import a policy in VeritaDC"));
check("no VeritaPolicy on the screen", !text.includes("VeritaPolicy"), (text.match(/.{0,50}VeritaPolicy.{0,30}/) || [""])[0]);
await page.screenshot({ path: `${OUT}/site-dcname-screen.png` });

const [xlsx] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Master List (Excel)" }).click()]);
check("workbook download name", /^VeritaDC_MasterList_.*\.xlsx$/.test(xlsx.suggestedFilename()), xlsx.suggestedFilename());
const path = `${OUT}/site-dcname-master.xlsx`;
await xlsx.saveAs(path);
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(path);
const about = wb.worksheets[0];
const aboutText = [];
about.eachRow((row) => row.eachCell((cell) => aboutText.push(String(cell.value ?? ""))));
check("About sheet is first and titled VeritaDC", aboutText.join(" ").includes("VeritaDC Master List"), aboutText.slice(0, 2).join(" | "));
check("About sheet has no VeritaPolicy", !aboutText.join(" ").includes("VeritaPolicy"));
check("page header says VeritaDC on every sheet", wb.worksheets.every((ws) => String(ws.headerFooter?.oddHeader || "").includes("VeritaDC Master List")));

const [zip] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.getByRole("button", { name: /All Starters/ }).click()]);
check("bundle download name", /^VeritaDC_Bundle_.*\.zip$/.test(zip.suggestedFilename()), zip.suggestedFilename());

await page.goto(`${BASE}/veritaassure`, { waitUntil: "networkidle" });
check("the public card still says Formerly VeritaPolicy", /formerly veritapolicy/i.test(await page.locator("body").innerText()));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
