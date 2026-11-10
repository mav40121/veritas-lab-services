// scripts/verify-ptinr-pairs-paste-ui.mjs
// Browser receipt for BUG-162: PT/INR Modules 2 and 3 (two-instrument and old-lot vs new-lot comparison) were fixed at 20
// pairs with no paste, while Module 1 grew and took a pasted column (BUG-149). Run against a LOCAL production build on a
// scratch database with made-up values (it registers an owner and provisions a lab, so it refuses any other host):
//   UI_REPO=<worktree> UI_PORT=<port> UI_SCRIPT=verify-ptinr-pairs-paste-ui.mjs UI_OUT=ptinr_pairs UI_DB=ptinr_pairs.db bash /c/Users/veril/projects/vls-ops/ui_run_repo_port.sh
//   1. 25 old-lot / new-lot pairs copied from Excel as two columns (tab between, CRLF after each) and pasted into Module 3's
//      first old-lot cell fill 25 rows, both columns, in order;
//   2. Module 2's Add 10 rows adds ten rows (20 -> 30); one pasted column into a Y cell fills only that column from that row;
//   3. Run Study saves all 25 Module 3 pairs and the results page lists the 25th;
//   4. Edit reopens with all 25 pairs (Edit read the first 20);
//   5. no page errors.
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
if (!["localhost", "127.0.0.1"].includes(new URL(BASE).hostname)) throw new Error("This check writes data, so it runs on a local server only.");
let passes = 0, failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (cond) passes++; else failures++; };
const call = async (method, p, body) => { const r = await fetch(BASE + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); try { return await r.json(); } catch { return {}; } };
const scratch = (fn) => { const d = new Database(process.env.SCRATCH_DB); try { return fn(d); } finally { d.close(); } };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(`${name} ran`, false, String(e?.message || e).split("\n")[0]); } };

const email = `ptinr-pairs-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: ["Pairs", "paste", "162!"].join("-"), name: "Made Up Director", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Pairs Lab", plan: "hospital" })).labId;
scratch((d) => {
  d.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE email = ?").run(email);
  d.prepare("UPDATE labs SET has_completed_onboarding = 1, clia_number = '99D9999162' WHERE id = ?").run(labId);
});
const rowOf = (name) => scratch((d) => d.prepare("SELECT id, status, data_points FROM studies WHERE test_name = ? ORDER BY id DESC LIMIT 1").get(name));
const NAME = "PT made-up pairs";
// 20 made-up normal PTs for Module 1, and 25 made-up old-lot / new-lot pairs (new lot 2% above old).
const NORMALS = Array.from({ length: 20 }, (_, i) => (11.0 + ((i * 7) % 15) * 0.1).toFixed(1));
const PAIRS = Array.from({ length: 25 }, (_, i) => { const x = +(10.5 + i * 0.3).toFixed(1); return [x, +(x * 1.02).toFixed(2)]; });
const PAIR_CLIP = PAIRS.map(([x, y]) => `${x}\t${y}\r\n`).join("");
const YCOL = Array.from({ length: 22 }, (_, i) => (12 + i * 0.2).toFixed(1));

const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();
page.setDefaultTimeout(10000);
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/`);
await page.evaluate(([tk, u]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u)); localStorage.setItem(`onboarding_dismissed_${u.id}`, "1"); }, [reg.token, reg.user]);
const paste = (locator, clip) => locator.evaluate((el, t) => { el.focus(); const dt = new DataTransfer(); dt.setData("text/plain", t); el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, clip);
const m1Cells = () => page.locator("div.rounded-xl, div.rounded-lg").filter({ has: page.getByText("Module 1: Normal Patient Mean", { exact: false }) }).last().locator("div.grid-cols-5").first().locator("input");
const m3x = () => page.getByLabel(/^Module 3 S\d{5} old lot PT$/);
const m3y = () => page.getByLabel(/^Module 3 S\d{5} new lot PT$/);
const m2x = () => page.getByLabel(/^Module 2 S\d{5} instrument 1 PT$/);
const m2y = () => page.getByLabel(/^Module 2 S\d{5} instrument 2 PT$/);
const vals = (loc) => loc.evaluateAll((els) => els.map((e) => e.value));

await step("1. paste 25 pairs into Module 3", async () => {
  await page.goto(`${BASE}/labs/${labId}/study/new`, { waitUntil: "networkidle" });
  await page.getByTestId("input-test-name").fill(NAME);
  await page.getByTestId("select-study-type").click();
  await page.getByRole("option", { name: /PT\/INR Geometric Mean/i }).click();
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
  await paste(m1Cells().first(), NORMALS.map((n) => `${n}\r\n`).join(""));
  check("Module 3 opens with 20 rows", (await m3x().count()) === 20, String(await m3x().count()));
  await paste(m3x().first(), PAIR_CLIP);
  await page.waitForTimeout(300);
  const xs = await vals(m3x()), ys = await vals(m3y());
  check("the 25 pasted pairs fill 25 rows", xs.length === 25 && ys.length === 25, `${xs.length} ${ys.length}`);
  check("both columns, in order", PAIRS.every(([x, y], i) => Number(xs[i]) === x && Number(ys[i]) === y), JSON.stringify(xs.slice(20)) + JSON.stringify(ys.slice(20)));
  await m3x().nth(20).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "bug162-1-module3-25-pairs.png"), animations: "disabled" });
});
await step("2. Module 2 Add 10 rows and a one-column paste", async () => {
  check("Module 2 opens with 20 rows", (await m2x().count()) === 20);
  await page.getByTestId("pt-module2-add-rows").click();
  check("Add 10 rows: 20 -> 30", (await m2x().count()) === 30, String(await m2x().count()));
  await paste(m2y().nth(4), YCOL.map((v) => `${v}\r\n`).join(""));
  await page.waitForTimeout(300);
  const xs = await vals(m2x()), ys = await vals(m2y());
  check("one column pasted into row 5's Y cell fills Y from row 5 down (22 values, 30 rows kept), X untouched", xs.length === 30 && ys.slice(4, 26).every((v, i) => Number(v) === Number(YCOL[i])) && ys.slice(0, 4).every((v) => v === "") && xs.every((v) => v === ""), JSON.stringify(ys.slice(0, 6)));
  // Module 2 holds no complete pair, so it isn't saved; clear it to keep the run about Module 3.
  await paste(m2y().first(), Array.from({ length: 30 }, () => "\r\n").join("") + "x");
});
let studyId = null;
await step("3. Run Study", async () => {
  await page.getByTestId("button-submit-study").click();
  await page.waitForURL(/\/study\/\d+\/results/, { timeout: 30000 });
  studyId = Number(page.url().match(/study\/(\d+)\/results/)?.[1]);
  await page.getByText("Geometric Mean PT", { exact: true }).first().waitFor({ timeout: 20000 });
  const ran = rowOf(NAME);
  const m3 = JSON.parse(ran?.data_points || "{}")?.module3?.data || [];
  const complete = m3.filter((d) => typeof d.x === "number" && typeof d.y === "number");
  check("stored: Module 3 holds all 25 pairs", complete.length === 25 && complete[24].x === PAIRS[24][0] && complete[24].y === PAIRS[24][1], `${complete.length} ${JSON.stringify(complete[24])}`);
  check("the results page lists the 25th specimen", (await page.locator("body").innerText()).includes("S00025"));
});
await step("4. Edit reopens with 25 pairs", async () => {
  await page.goto(`${BASE}/labs/${labId}/study/${studyId}/edit`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Data Entry" }).click();
  await page.getByTestId("pt-add-instrument").waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
  const xs = await vals(m3x());
  check("Edit shows all 25 Module 3 pairs (it read the first 20)", xs.length === 25 && Number(xs[24]) === PAIRS[24][0], `${xs.length} rows`);
});
check("5. no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED, ${passes} PASS` : `\nALL PASS (${passes} PASS)`);
process.exit(failures ? 1 : 0);
