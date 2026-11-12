// scripts/verify-digest-autodraft-ui.mjs
//
// Browser receipt (Gate 3 step 8) for the compliance digest's daily draft job (Michael 2026-11-11, Q281 = 1) and the digest's
// place in the main navigation. On a local production build with a scratch DB, a made-up owner and lab, all written through
// the app's own routes or the scratch DB, never production:
//   N1. desktop: the VeritaAssure menu has "Compliance Digest" right under Inspection Readiness for a signed-in user, linked
//       into the lab (/labs/:labId/digest); it opens the digest, and the menu reads as active there
//   N2. from a page outside a lab the entry still lands in the lab (the bare /digest route resolves it)
//   N3. signed out: no Compliance Digest entry
//   N4. phone: the mobile VeritaAssure group has it right under Inspection Readiness
//   A1. the settings card's toggle reads "Draft each issue automatically when the period ends", off by default; the owner
//       turns it on and saves
//   A2. the job (run now through the admin route, the same run the schedule makes) drafts last month; a hand-made draft
//       of the month before reads "Drafted <date>", the job's "Drafted automatically on <date>"; a second run adds nothing
//   A3. once the owner publishes it, the row still says it was drafted automatically; a quarterly lab's quarter likewise
//   D1. light and dark mode: the note reads at 4.5:1 or better
// Screenshots go to OUT. Run: PW_BASE=http://localhost:5251 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-digest-autodraft-ui.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0, passes = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j };
};
const sql = (q, ...a) => { const db = new Database(process.env.SCRATCH_DB); try { return /^\s*select/i.test(q) ? db.prepare(q).get(...a) : db.prepare(q).run(...a).lastInsertRowid; } finally { db.close(); } };
const pw = ["Digest", "Auto", "77!"].join("-");
const stamp = Date.now();
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDay = (d) => `${SHORT[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const nyToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthBefore = (start) => { let y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1; if (m < 1) { m = 12; y--; } return `${y}-${String(m).padStart(2, "0")}-01`; };

// ── A made-up owner and lab on the scratch DB ─────────────────────────────────────────────────────────────────────────
const email = `digest-auto-ui-owner-${stamp}@example.com`;
const reg = await call("POST", "/api/auth/register", { email, password: pw, name: "Made-up Owner Tregarthen", hipaa_acknowledged: true });
const OWNER = { email, token: reg.body.token, id: Number(sql("SELECT id FROM users WHERE email = ?", email)?.id) };
const LAB = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Digest Autodraft Lab", plan: "hospital" })).body.labId;
sql("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?", OWNER.id);
sql("UPDATE labs SET has_completed_onboarding = 1, clia_number = '22D7790012', time_zone = 'America/New_York' WHERE id = ?", LAB);
const D = `/api/labs/${LAB}/digest`;
const s0 = (await call("GET", `${D}/settings`, undefined, OWNER.token)).body;
const LAST = s0.default_period;
check("setup: a made-up lab, monthly, the daily draft off by default", LAB > 0 && !!OWNER.token && s0.enabled === false && s0.frequency === "monthly" && /^\d{4}-\d{2}-01$/.test(LAST?.start || ""), JSON.stringify({ LAB, LAST, enabled: s0.enabled }));

// ── Browser ─────────────────────────────────────────────────────────────────────────────────────────────────────────
let browser;
try { browser = await chromium.launch(); } catch (e) { console.log(`INFO  bundled Chromium didn't start (${String(e.message || e).split("\n")[0]}); using channel chrome`); browser = await chromium.launch({ channel: "chrome" }); }
const go = async (page, url, opts) => { try { return await page.goto(url, opts); } catch (e) { if (!/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET/.test(String(e?.message))) throw e; console.log("INFO  navigation retried after a network blip"); return page.goto(url, opts); } };
const openAs = async (u, path, opts = {}) => {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1600, height: 950 }, colorScheme: opts.colorScheme || "light" });
  const page = await ctx.newPage();
  await go(page, `${BASE}/`);
  if (u) {
    const me = await page.evaluate(async ([b, t]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } })).json(), [BASE, u.token]);
    await page.evaluate(([t, usr, l]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(usr.user || usr)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [u.token, me, LAB]);
  }
  await go(page, `${BASE}${path}`, { waitUntil: "networkidle" });
  return page;
};
const text = async (page, testId) => ((await page.getByTestId(testId).first().textContent().catch(() => "")) || "").replace(/\s+/g, " ").trim();
const visible = (page, testId) => page.getByTestId(testId).first().isVisible().catch(() => false);
const vaButton = (page) => page.locator("header nav").getByRole("button", { name: /VeritaAssure/ }).first();
// Lit = the active classes themselves, not their hover: variants (the idle button carries hover:bg-secondary).
const lit = async (page) => {
  const cls = ((await vaButton(page).getAttribute("class").catch(() => "")) || "").split(/\s+/);
  return cls.includes("bg-secondary") && cls.includes("text-foreground") && !cls.includes("text-muted-foreground");
};

// N1. Desktop menu, signed in, from the lab's Inspection Readiness page
const owner = await openAs(OWNER, `/labs/${LAB}/readiness`);
check("N1a. the VeritaAssure menu lights on a lab's Inspection Readiness page (a /labs/:labId route)", await lit(owner));
await vaButton(owner).click();
await owner.getByTestId("nav-digest").waitFor({ timeout: 10000 }).catch(() => {});
const rBox = await owner.getByTestId("nav-readiness").boundingBox().catch(() => null);
const dBox = await owner.getByTestId("nav-digest").boundingBox().catch(() => null);
const gBox = await owner.getByTestId("nav-modules-grid").boundingBox().catch(() => null);
check("N1b. the menu has Compliance Digest, linked into the lab", (await text(owner, "nav-digest")) === "Compliance Digest" && (await owner.getByTestId("nav-digest").getAttribute("href")) === `/labs/${LAB}/digest`,
  `${await text(owner, "nav-digest")} ${await owner.getByTestId("nav-digest").getAttribute("href").catch(() => "")}`);
check("N1c. it sits right under Inspection Readiness, above the module list", !!rBox && !!dBox && !!gBox && Math.abs(dBox.x - rBox.x) < 2 && dBox.y > rBox.y && dBox.y - (rBox.y + rBox.height) < 4 && dBox.y + dBox.height <= gBox.y,
  JSON.stringify({ rBox, dBox, gY: gBox?.y }));
await owner.waitForTimeout(300);
await owner.screenshot({ path: `${OUT}/nav-menu-digest-light.png`, clip: { x: 0, y: 0, width: 1600, height: Math.min(950, Math.ceil((gBox?.y ?? 400) + (gBox?.height ?? 400) + 24)) } });
await owner.getByTestId("nav-digest").click();
await owner.getByTestId("digest-settings").waitFor({ timeout: 20000 }).catch(() => {});
check("N1d. it opens the lab's digest", owner.url().endsWith(`/labs/${LAB}/digest`) && await visible(owner, "digest-settings"), owner.url());
check("N1e. the VeritaAssure menu reads as active on the digest", await lit(owner));

// N2. From a page outside a lab (the home page) the entry still lands in the lab
const home = await openAs(OWNER, "/");
check("N2a. on the home page (no lab in the address) the menu isn't lit", !(await lit(home)));
await vaButton(home).click();
await home.getByTestId("nav-digest").waitFor({ timeout: 10000 }).catch(() => {});
check("N2b. there the entry links to the bare /digest", (await home.getByTestId("nav-digest").getAttribute("href").catch(() => "")) === "/digest");
await home.getByTestId("nav-digest").click();
await home.waitForURL(new RegExp(`/labs/${LAB}/digest$`), { timeout: 20000 }).catch(() => {});
await home.getByTestId("digest-settings").waitFor({ timeout: 20000 }).catch(() => {});
check("N2c. and lands on the lab's digest", home.url().endsWith(`/labs/${LAB}/digest`) && await visible(home, "digest-settings"), home.url());

// N3. Signed out
const anon = await openAs(null, "/");
await vaButton(anon).click();
await anon.getByTestId("nav-readiness").waitFor({ timeout: 10000 }).catch(() => {});
check("N3. signed out, the menu has Inspection Readiness and no Compliance Digest", await visible(anon, "nav-readiness") && (await anon.getByTestId("nav-digest").count()) === 0);

// N4. Phone
const phone = await openAs(OWNER, `/labs/${LAB}/digest`, { viewport: { width: 390, height: 844 } });
await phone.getByTestId("nav-hamburger").click();
// The phone menu's group button (the desktop menu's trigger, hidden here, is the one with aria-haspopup).
const vaGroup = phone.locator("button[aria-expanded]:not([aria-haspopup])", { hasText: "VeritaAssure" }).first();
await vaGroup.click();
const groupLinks = vaGroup.locator("xpath=following-sibling::div[1]").locator("a");
await groupLinks.first().waitFor({ timeout: 10000 }).catch(() => {});
const labels = (await groupLinks.allInnerTexts()).map((t) => t.trim());
const at = labels.indexOf("Inspection Readiness");
const digestHref = await groupLinks.nth(at + 1).getAttribute("href").catch(() => "");
check("N4a. the phone menu's VeritaAssure group has Compliance Digest right under Inspection Readiness, linked into the lab",
  at >= 0 && labels[at + 1] === "Compliance Digest" && digestHref === `/labs/${LAB}/digest`, JSON.stringify({ first: labels.slice(0, 4), digestHref }));
await phone.screenshot({ path: `${OUT}/nav-mobile-digest-light.png` });
await groupLinks.nth(at + 1).click();
await phone.getByTestId("digest-settings").waitFor({ timeout: 20000 }).catch(() => {});
check("N4b. it opens the digest on the phone too", phone.url().endsWith(`/labs/${LAB}/digest`) && await visible(phone, "digest-settings"), phone.url());

// A1. The settings toggle
const toggle = owner.getByTestId("settings-auto-draft");
const card = await text(owner, "digest-settings");
check("A1a. the toggle reads plainly: \"Draft each issue automatically when the period ends\", \"You still review and publish it.\"",
  card.includes("Draft each issue automatically when the period ends") && card.includes("You still review and publish it. Off by default.") && !card.includes(String.fromCharCode(0x2014)), card.slice(0, 400));
check("A1b. it is off by default", (await toggle.getAttribute("data-state")) === "unchecked");
await toggle.click();
const saveResp = owner.waitForResponse((r) => r.url().includes("/digest/settings") && r.request().method() === "PUT", { timeout: 15000 });
await owner.getByTestId("settings-save").click();
const saved = await (await saveResp).json().catch(() => ({}));
check("A1c. Save settings stores it on", saved.enabled === true && sql("SELECT enabled FROM digest_settings WHERE lab_id = ?", LAB)?.enabled === 1, JSON.stringify(saved));
// Clear of the sticky header (64px), so the card's own heading shows.
await owner.evaluate(() => { const el = document.querySelector('[data-testid="digest-settings"]'); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 88); });
await owner.waitForTimeout(200);
await owner.getByTestId("digest-settings").screenshot({ path: `${OUT}/digest-settings-autodraft-light.png` });

// A2. A hand-made draft of the month before, then the job's draft of last month
const PRIOR = monthBefore(LAST.start);
const manual = await call("POST", `${D}/issues`, { periodStart: PRIOR }, OWNER.token);
const run1 = await call("POST", "/api/admin/digest-autodraft/run", { secret: ADMIN, labId: LAB });
const AUTO = Number(run1.body.issues?.[0]?.issue_id);
check("A2a. the job (run now) drafts last month for the lab, as a draft by the system", run1.status === 200 && run1.body.drafted === 1 && run1.body.issues?.[0]?.period_start === LAST.start
  && sql("SELECT status, created_by_job, created_by_user_id FROM digest_issues WHERE id = ?", AUTO)?.created_by_job === 1, JSON.stringify(run1.body));
const run2 = await call("POST", "/api/admin/digest-autodraft/run", { secret: ADMIN, labId: LAB });
check("A2b. a second run adds nothing (already done)", run2.body.drafted === 0 && run2.body.alreadyDone === 1 && sql("SELECT COUNT(*) AS n FROM digest_issues WHERE lab_id = ? AND period_start = ?", LAB, LAST.start)?.n === 1, JSON.stringify(run2.body));
await owner.reload({ waitUntil: "networkidle" });
await owner.getByTestId(`issue-row-${AUTO}`).waitFor({ timeout: 20000 }).catch(() => {});
const today = nyToday();
const autoText = await text(owner, `issue-row-${AUTO}-auto`);
check(`A2c. the job's draft reads "Drafted automatically on ${fmtDay(today)}"`, autoText === `Drafted automatically on ${fmtDay(today)}` && (await text(owner, `issue-row-${AUTO}`)).includes("Draft"), autoText);
const manualRow = await text(owner, `issue-row-${manual.body.id}`);
check("A2d. the hand-made draft reads \"Drafted <date>\", with no automatic note", manualRow.endsWith(`Drafted ${fmtDay(today)}`) && !manualRow.includes("automatically") && !(await visible(owner, `issue-row-${manual.body.id}-auto`)), manualRow);
await owner.getByTestId("digest-issues").screenshot({ path: `${OUT}/digest-list-autodraft-light.png` });
await owner.screenshot({ path: `${OUT}/digest-page-autodraft-light.png`, fullPage: true });

// A3. Published by the owner, and a quarter
await call("POST", `${D}/issues/${AUTO}/publish`, {}, OWNER.token);
await call("PUT", `${D}/settings`, { frequency: "quarterly" }, OWNER.token);
const run3 = await call("POST", "/api/admin/digest-autodraft/run", { secret: ADMIN, labId: LAB });
const QAUTO = Number(run3.body.issues?.[0]?.issue_id);
await owner.reload({ waitUntil: "networkidle" });
await owner.getByTestId(`issue-row-${QAUTO}`).waitFor({ timeout: 20000 }).catch(() => {});
const pubRow = await text(owner, `issue-row-${AUTO}`);
check("A3a. after the owner publishes it, the row reads Published and still says it was drafted automatically", pubRow.includes(`Published ${fmtDay(today)}`) && pubRow.endsWith(`Drafted automatically on ${fmtDay(today)}`), pubRow);
check("A3b. a quarterly lab's job draft is the last finished quarter, with the same note", run3.body.drafted === 1 && (await text(owner, `issue-row-${QAUTO}-auto`)) === `Drafted automatically on ${fmtDay(today)}`
  && /^Q[1-4] \d{4} \((January|April|July|October) to (March|June|September|December)\)/.test(await text(owner, `issue-row-${QAUTO}`)),`${JSON.stringify(run3.body)} | ${await text(owner, `issue-row-${QAUTO}`)}`);
check("A3c. the job never published or sent anything: only the issue the owner published is published, and no notice went out",
  sql("SELECT COUNT(*) AS n FROM digest_issues WHERE lab_id = ? AND status = 'published'", LAB)?.n === 1 && sql("SELECT COUNT(*) AS n FROM digest_issues WHERE notice_sent_at IS NOT NULL")?.n === 0);
await owner.getByTestId("digest-issues").screenshot({ path: `${OUT}/digest-list-autodraft-published-light.png` });

// D1. Dark mode
const contrast = (page, testId, bgSelector) => page.evaluate(([t, b]) => {
  const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
  const lum = ([r, g, b2]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b2); };
  const el = document.querySelector(`[data-testid="${t}"]`);
  let bg = el && el.closest(b);
  // The first ancestor with a solid background.
  let back = null; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] > 0.9)) { back = c; break; } }
  if (!el || !back) return { ratio: 0 };
  const fg = parse(getComputedStyle(el).color);
  const [hi, lo] = [lum(fg), lum(back)].sort((x, y) => y - x);
  return { ratio: Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100, fg, back, bg: !!bg };
}, [testId, bgSelector]);
const cLight = await contrast(owner, `issue-row-${QAUTO}-auto`, '[data-testid="digest-issues"]');
check("D1a. light mode: the note reads at 4.5:1 or better", cLight.ratio >= 4.5, JSON.stringify(cLight));
const dark = await openAs(OWNER, `/labs/${LAB}/digest`, { colorScheme: "dark" });
await dark.getByTestId(`issue-row-${QAUTO}-auto`).waitFor({ timeout: 20000 }).catch(() => {});
const c = await contrast(dark, `issue-row-${QAUTO}-auto`, '[data-testid="digest-issues"]');
check("D1b. dark mode: the note reads at 4.5:1 or better", (await dark.evaluate(() => document.documentElement.classList.contains("dark"))) && c.ratio >= 4.5, JSON.stringify(c));
await dark.getByTestId("digest-issues").screenshot({ path: `${OUT}/digest-list-autodraft-dark.png` });

await browser.close();
console.log(`${passes} PASS, ${failures} FAIL`);
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
