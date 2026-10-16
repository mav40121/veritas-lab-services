// scripts/verify-export-all-ui.mjs
//
// Browser receipt: Download all of this lab's records (2026-10-16, Q50 = 1). LOCAL production build with the
// Content-Security-Policy enforced + scratch DB only. Through the real Lab Members page:
//   1. the owner of a CANCELLED lab sees the card, builds the download, and the Download button saves a zip
//      (anchor download, no fetch + blob) that holds Index.xlsx and the records workbooks
//   2. an admin member does not see the card
//   3. no CSP violations; light, dark, 390px
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-export-all-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const JSZip = require("jszip");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return { status: r.status, body: await r.json() }; } catch { return { status: r.status, body: {} }; } };

const stamp = Date.now();
const owner = await call("POST", "/api/auth/register", { email: `export-owner-${stamp}@example.com`, password: ["Zq", "exp", "7x!"].join("-"), name: "Jordan Ellis", hipaa_acknowledged: true });
const admin = await call("POST", "/api/auth/register", { email: `export-admin-${stamp}@example.com`, password: ["Zq", "exp", "7x!"].join("-"), name: "Riley Chen", hipaa_acknowledged: true });
const lab = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: `export-owner-${stamp}@example.com`, labName: "Riverside Regional Medical Center (Export QA)", plan: "hospital" })).body?.labId;
{
  const d = new Database(process.env.SCRATCH_DB);
  const now = new Date().toISOString();
  for (const u of [owner, admin]) d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(u.body?.user?.id);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(lab);
  d.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 1, ?, ?, ?)").run(lab, admin.body?.user?.id, now, now, now);
  // the subscription ends: the card must still work
  d.prepare("UPDATE labs SET plan = 'free', subscription_status = 'canceled' WHERE id = ?").run(lab);
  d.close();
}
check("0. QA owner, admin member and a cancelled lab", !!lab && !!owner.body?.token && !!admin.body?.token);

const browser = await chromium.launch();
const open = async (who, scheme, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, acceptDownloads: true });
  const page = await ctx.newPage();
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, u, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify({ ...u, hasCompletedOnboarding: true, onboardingSeen: true })); localStorage.setItem("veritas_active_lab_id", String(l)); }, [who.body.token, who.body.user, lab]);
  await page.goto(`${BASE}/labs/${lab}/members`, { waitUntil: "networkidle" });
  return { ctx, page, csp };
};

{
  const { ctx, page, csp } = await open(owner, "light", 1280);
  const card = page.getByTestId("export-all-card");
  await card.waitFor({ timeout: 20000 }).catch(() => {});
  check("1a. the owner sees the Download all records card", await card.isVisible(), "");
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/export-all-card-before-light.png` });
  await page.getByTestId("export-all-build").click();
  const dl = page.getByTestId("export-all-download");
  await dl.waitFor({ timeout: 120000 }).catch(() => {});
  check("1b. the build finishes and a Download button appears", await dl.isVisible(), (await dl.innerText().catch(() => "")) || "");
  const readyText = await page.getByTestId("export-all-ready").innerText().catch(() => "");
  check("1c. it says when the download expires", /Available until/.test(readyText), readyText);
  await card.screenshot({ path: `${OUT}/export-all-card-ready-light.png` });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), dl.click()]);
  const file = `${OUT}/${download.suggestedFilename()}`;
  await download.saveAs(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.keys(zip.files);
  check("1d. clicking Download saves the zip (anchor download) with Index.xlsx and records", /Riverside_Regional_Medical_Center_Export_QA_VeritaAssure_Records_\d{4}-\d{2}-\d{2}\.zip/.test(download.suggestedFilename()) && names.includes("Index.xlsx") && names.some((n) => n.startsWith("Records/") && n.endsWith(".xlsx")), `${download.suggestedFilename()} ${fs.statSync(file).size} bytes, ${names.filter((n) => !n.endsWith("/")).length} files`);
  check("3a. no Content-Security-Policy violations (light)", csp.length === 0, csp.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  const { ctx, page, csp } = await open(owner, "dark", 1280);
  const card = page.getByTestId("export-all-card");
  await card.waitFor({ timeout: 20000 }).catch(() => {});
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/export-all-card-dark.png` });
  const bg = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
  check("3b. dark mode: the card renders on a dark background", /rgb\((\d+), (\d+), (\d+)\)/.test(bg) && Number(bg.match(/\d+/)[0]) < 80, bg);
  check("3c. no Content-Security-Policy violations (dark)", csp.length === 0, csp.slice(0, 2).join(" | "));
  await ctx.close();
}
{
  const { ctx, page } = await open(owner, "light", 390);
  const card = page.getByTestId("export-all-card");
  await card.waitFor({ timeout: 20000 }).catch(() => {});
  await card.scrollIntoViewIfNeeded();
  await card.screenshot({ path: `${OUT}/export-all-card-390.png` });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const box = await card.boundingBox();
  check("3d. 390px: the card fits the screen", !!box && box.x >= 0 && box.x + box.width <= 390 + 1, `card ${box && Math.round(box.x)}..${box && Math.round(box.x + box.width)}, page overflow ${over}px`);
  await ctx.close();
}
{
  const { ctx, page } = await open(admin, "light", 1280);
  await page.getByText(/Members|Invite a new member/).first().waitFor({ timeout: 20000 }).catch(() => {});
  check("2. an admin member does not see the card", (await page.getByTestId("export-all-card").count()) === 0, "");
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
