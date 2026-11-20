// scripts/verify-effectiveness-measured-ui.mjs
//
// Browser receipt (Gate 3 step 8) for measured effectiveness monitoring (Lifepoint ask, Michael 2026-11-19). On a LOCAL
// production build with a scratch database and a made-up lab and finding (it registers a user and provisions a lab, so it
// refuses any other host):
//   M1. the panel takes what is audited, a target, a sample and a schedule; Start monitoring with "Monthly for 4 months"
//       makes 30/60/90/120-day checkpoints and shows the plan
//   M2. Record result on the 30-day check: 27 of 30 reads "Meets the 90% target."; the row then says 27 of 30 compliant
//       (90%), Met the target
//   M3. on a closed finding, 26 of 30 reads below the target, the button says "Record as not effective", and the finding
//       reopens
//   M4. 31 of 30 is refused on screen with the reason and the button disabled
//   M5. Edit plan changes the target; recorded checkpoints keep their result
//   plus dark mode and a phone width with no sideways scroll. Screenshots go to RECEIPT_DIR, or OUT when unset. Run (from the repo):
//   PW_BASE=http://localhost:5292 SCRATCH_DB=<scratch db> RECEIPT_DIR=<dir> node scripts/verify-effectiveness-measured-ui.mjs
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5292", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
const SHOTS = process.env.RECEIPT_DIR || process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
if (!process.env.SCRATCH_DB) throw new Error("SCRATCH_DB is required: this check sets the made-up finding's completion date in a scratch database.");
mkdirSync(SHOTS, { recursive: true });
const PW = ["Mon", "itor", "77!"].join("-");
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body, token, labId) => {
  const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch { /* not JSON */ }
  return { s: r.status, j };
};
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `monitor-${name}.png`), fullPage: false, animations: "disabled" });

const stamp = Date.now();
const email = `monitor-owner-${stamp}@example.test`;
const owner = (await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Director", hipaa_acknowledged: true })).j;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Monitoring UI Lab", plan: "hospital" })).j.labId;
scratch((d) => {
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = ? WHERE id = ?").run(`99D${String(stamp).slice(-7)}`, labId);
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
});
const fid = (await call("POST", `/api/labs/${labId}/findings`, { accreditor: "CMS", anchor_date: "2026-09-01", standard_ref: "Made-up D5401", description: "Made-up: reagent refrigerator temperature log missing weekend readings.", corrective_action: "Made-up: weekend reader assigned." }, owner.token, labId)).j.id;
scratch((d) => d.prepare("UPDATE findings SET completion_date = '2026-10-01' WHERE id = ?").run(fid));
const finding = () => scratch((d) => d.prepare("SELECT status, monitor_target_pct, monitor_measure, monitor_sample FROM findings WHERE id = ?").get(fid));
const checks = () => scratch((d) => d.prepare("SELECT interval_days, status, audited_count, compliant_count FROM finding_effectiveness_checks WHERE finding_id = ? ORDER BY interval_days").all(fid));
check("setup: a made-up lab and a finding with a completion date", !!labId && !!fid, JSON.stringify({ labId, fid }));

let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const errors = [];
const openAs = async (opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}/`);
  const me = (await call("GET", "/api/auth/me", undefined, owner.token)).j;
  await page.evaluate(([tk, usr, scheme, lab]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(usr)); localStorage.setItem(`onboarding_dismissed_${usr.id}`, "1"); localStorage.setItem("theme", scheme); localStorage.setItem("veritas_active_lab_id", String(lab)); }, [owner.token, me.user ?? me, opts.colorScheme || "light", labId]);
  return page;
};
const url = `${BASE}/labs/${labId}/veritaresponse/${fid}`;
const open = async (page) => { await page.goto(url, { waitUntil: "networkidle" }); await page.getByTestId("eff-panel").waitFor({ timeout: 20000 }); await page.getByTestId("eff-panel").scrollIntoViewIfNeeded(); };
const rows = (page) => page.getByTestId("eff-check").allInnerTexts();
const record = async (page, days, audited, compliant) => {
  await page.getByTestId(`eff-record-${days}`).click();
  await page.getByTestId("eff-audited").fill(String(audited));
  await page.getByTestId("eff-compliant").fill(String(compliant));
};

const page = await openAs();
await open(page);
// M1
await page.getByTestId("eff-measure").fill("Made-up: temperature logs with every reading recorded");
await page.getByTestId("eff-target").fill("90");
await page.getByTestId("eff-sample").fill("30");
await page.getByTestId("eff-schedule").click();
await page.getByRole("option", { name: "Monthly for 4 months" }).click();
await shot(page, "1-plan");
await page.getByTestId("eff-start").click();
await page.getByTestId("eff-check").first().waitFor({ timeout: 15000 });
const r1 = await rows(page);
const f1 = finding();
check("M1a. monthly for 4 months makes the 30, 60, 90 and 120-day checkpoints", r1.length === 4 && /^30-day/.test(r1[0]) && /^120-day/.test(r1[3]), JSON.stringify(r1));
check("M1b. the plan is stored and shown", f1.monitor_target_pct === 90 && f1.monitor_sample === 30 && /Target: 90%/.test(await page.getByTestId("eff-plan-summary").innerText()), JSON.stringify(f1));
// M2
await record(page, 30, 30, 27);
check("M2a. 27 of 30 reads as meeting the target", /90% compliant\.\s*Meets the 90% target\./.test(await page.getByTestId("eff-outcome").innerText()));
await shot(page, "2-record-meets");
await page.getByTestId("eff-submit").click();
await page.waitForTimeout(1200);
const r2 = await rows(page);
check("M2b. the 30-day row shows the counts and Met the target", /27 of 30 compliant \(90%\)\. Met the target/.test(r2[0]) && checks()[0].status === "effective", JSON.stringify(r2[0]));
// M3
scratch((d) => d.prepare("UPDATE findings SET status = 'closed' WHERE id = ?").run(fid));
await open(page);
await record(page, 60, 30, 26);
const below = await page.getByTestId("eff-outcome").innerText();
const btn = await page.getByTestId("eff-submit").innerText();
check("M3a. 26 of 30 reads below the target and the button says so", /86\.7% compliant\.\s*Below the 90% target/.test(below) && /Record as not effective/.test(btn), `${below} | ${btn}`);
await shot(page, "3-record-below");
await page.getByTestId("eff-submit").click();
await page.waitForTimeout(1500);
check("M3b. the finding reopens and the row says below the target", finding().status === "drafting" && /Below the target \(finding reopened\)/.test((await rows(page))[1]), JSON.stringify({ st: finding().status, r: (await rows(page))[1] }));
// M4
await record(page, 90, 30, 31);
check("M4. 31 of 30 is refused on screen, Record disabled", /Compliant can't be more than audited/.test(await page.getByTestId("eff-outcome").innerText()) && await page.getByTestId("eff-submit").isDisabled());
await page.keyboard.press("Escape");
// M5
await page.getByTestId("eff-edit-plan").click();
await page.getByRole("dialog").getByTestId("eff-target").fill("95");
await page.getByTestId("eff-save-plan").click();
await page.waitForFunction(() => /Target: 95%/.test(document.querySelector('[data-testid="eff-plan-summary"]')?.textContent || ""), null, { timeout: 15000 }).catch(() => {});
const c5 = checks();
check("M5. Edit plan changes the target; recorded checkpoints keep their result", finding().monitor_target_pct === 95 && /Target: 95%/.test(await page.getByTestId("eff-plan-summary").innerText()) && c5[0].status === "effective" && c5[1].status === "not_effective", JSON.stringify(c5));
await page.getByTestId("eff-panel").scrollIntoViewIfNeeded();
await shot(page, "4-after");
// Dark and phone
const dark = await openAs({ colorScheme: "dark" });
await open(dark);
await dark.screenshot({ path: path.join(SHOTS, "monitor-5-dark.png"), animations: "disabled" });
check("dark: the panel shows the summary line", /2 of 4 checkpoints recorded; 1 below the 95% target\./.test(await dark.getByTestId("eff-summary").innerText()));
const phone = await openAs({ viewport: { width: 390, height: 844 } });
await open(phone);
await phone.screenshot({ path: path.join(SHOTS, "monitor-6-phone.png"), animations: "disabled" });
check("phone: no sideways page scroll", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
check("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
writeFileSync(path.join(SHOTS, "monitor-result.txt"), `${passes} PASS, ${failures} FAIL\n`);
console.log(failures === 0 ? `\nALL PASS (${passes})` : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
