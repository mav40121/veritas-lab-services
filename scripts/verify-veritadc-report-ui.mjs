// scripts/verify-veritadc-report-ui.mjs
// Gate 3 receipt for the VeritaDC readiness report (site review 2026-11-05). Run against a LOCAL server on a scratch database, with made-up
// people (it registers an owner and provisions a lab, so it refuses any other host). Usage:
//   PW_BASE=http://localhost:5197 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-veritadc-report-ui.mjs
// In a real browser: change three policies on the tracker screen, click Download PDF, and compare the PDF's numbers and rows with the screen's.
// Also calls the VeritaScan auto-completion audit route: refused without its header, and numbers and booleans only with it.
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5197", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error("This check writes data, so it runs on a local server only.");
const PW = ["Dc", "report", "77!"].join("-");
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try { return await r.json(); } catch { return {}; }
};

const email = `dc-report-${Date.now()}@example.test`;
const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Made Up Owner", hipaa_acknowledged: true });
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "DC Report Lab", plan: "hospital" })).labId;
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

const rows = page.locator("tbody tr").filter({ has: page.getByRole("combobox") });
await rows.first().waitFor({ timeout: 20000 });
check("tracker shows the master list", (await rows.count()) === 58, String(await rows.count()));
const setStatus = async (row, label) => {
  await row.getByRole("combobox").click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.waitForLoadState("networkidle");
};
const named = rows.nth(0).getByPlaceholder("e.g. QC Policy (POL-003)");
await named.fill("Made Up Policy Name");
await named.press("Enter");
await page.waitForLoadState("networkidle");
await setStatus(rows.nth(0), "Complete");
await setStatus(rows.nth(1), "In Progress");
await rows.nth(2).getByRole("button", { name: "N/A", exact: true }).click();
await page.waitForLoadState("networkidle");
await page.waitForTimeout(500);

const body = await page.locator("body").innerText();
const screenScore = (body.match(/Readiness Score\s*(\d+)%/) || [])[1];
check("screen: readiness is 1 complete of 57 applicable", screenScore === "2", String(screenScore));
await page.getByText("Readiness Score").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/site-dc-screen.png` });

const [report] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.getByRole("button", { name: "Download PDF" }).click()]);
check("download name", report.suggestedFilename() === "VeritaDC-Report.pdf", report.suggestedFilename());
const pdfPath = `${OUT}/site-dc-report.pdf`;
await report.saveAs(pdfPath);
const py = `import fitz,json,re,sys
d=fitz.open(sys.argv[1])
pages=[re.sub(r"\\s+"," ",p.get_text()) for p in d]
d[0].get_pixmap(dpi=80).save(sys.argv[2])
print(json.dumps({"author":d.metadata.get("author"),"pages":pages}))`;
const out = spawnSync("python", ["-c", py, pdfPath, `${OUT}/site-dc-report-p1.png`], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
if (out.status !== 0) { check("PDF text read", false, out.stderr.slice(0, 300)); }
else {
  const pdf = JSON.parse(out.stdout);
  const all = pdf.pages.join(" ");
  check("PDF: summary row is the screen's numbers (57 applicable, 1, 1, 55, 1 N/A, 2%)", /57 1 1 55 1 2%/.test(all), all.slice(0, 500));
  check("PDF: the lab's own policy name prints", all.includes("Made Up Policy Name"));
  check("PDF: lists the screen's master list, not the old requirement list", all.includes(await rows.nth(0).locator("td").nth(1).innerText().then((s) => s.split("\n")[0].trim())));
  check("PDF: review block on page 1", /DIRECTOR OR DESIGNEE/i.test(pdf.pages[0]));
  check("PDF: lab name prints", all.includes("DC Report Lab"));
  check("PDF: retired service line rows gone", !/Blood Bank: ?(Yes|No)/.test(all));
  check("PDF: empty library page gone", !all.includes("No policies in library"));
  check("PDF: footer pages", new RegExp(`Page 1 of ${pdf.pages.length}`).test(all));
  check("PDF: no blank page", pdf.pages.every((t) => t.trim().length > 200), pdf.pages.map((t) => t.length).join(","));
  check("PDF: author metadata kept", pdf.author === "Perplexity Computer", String(pdf.author));
  for (const bad of ["/#/", "localhost", "127.0.0.1", "radiant-quietude", "staging", "preview", "—"]) check(`PDF: no ${JSON.stringify(bad)}`, !all.includes(bad));
}

// The audit route
const audit = "/api/admin/veritascan/auto-completion-audit";
check("audit: refused with no header", (await fetch(BASE + audit)).status === 403);
check("audit: refused with the secret in the URL", (await fetch(`${BASE}${audit}?secret=${ADMIN}`)).status === 403);
const res = await fetch(BASE + audit, { headers: { "x-admin-secret": ADMIN } });
const json = await res.json();
check("audit: 200 with the header", res.status === 200 && json.ok === true);
const onlyCounts = (v) => Array.isArray(v) ? v.every(onlyCounts) : v && typeof v === "object" ? Object.values(v).every(onlyCounts) : typeof v === "number" || typeof v === "boolean";
check("audit: every value is a number or boolean", onlyCounts(json));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
