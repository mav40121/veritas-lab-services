// scripts/verify-policy-page-copy.mjs
// Receipt (2026-10-08): VeritaDC page copy no longer advertises shipped features
// as future "phases". Michael Q21 "1" (the My Documents subtitle, ahead of the
// St. Charles 10/14 demo), plus the same class in two more places:
//   - My Documents subtitle: approval workflow, e-signature, attestations are live
//   - Approve dialog: drop "21 CFR Part 11 password re-auth lands in Phase 3."
//   - Compliance dashboard: drop "Phase 6B will add cron-fired email reminders"
//     (policy review reminders already run on a schedule)
// LOCAL server + scratch DB only. Usage:
//   PW_BASE=http://localhost:5143 SCRATCH_DB=<scratch db> OUT=<dir> node scripts/verify-policy-page-copy.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const BASE = process.env.PW_BASE || "http://localhost:5143", ADMIN = process.env.ADMIN_SECRET || "test-admin-secret", OUT = process.env.OUT || ".";
const call = async (method, path, body, token, isForm) => {
  const r = await fetch(BASE + path, { method, headers: { ...(isForm ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : (isForm ? body : JSON.stringify(body)) });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
};
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const stamp = Date.now();
const reg = async (tag, name) => {
  const email = `copy-${tag}-${stamp}@example.com`;
  const r = (await call("POST", "/api/auth/register", { email, password: "testpass123", name, hipaa_acknowledged: true })).body;
  return { email, token: r.token };
};
const owner = await reg("owner", "Olive Owner"), prep = await reg("prep", "Pat Preparer");
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "Copy Lab", plan: "hospital" })).body.labId;
const sdb = new Database(process.env.SCRATCH_DB);
const uid = (u) => sdb.prepare("SELECT id FROM users WHERE email = ?").get(u.email).id;
const now = new Date().toISOString();
sdb.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'admin', '{}', 'active', 1, ?, ?, ?)").run(labId, uid(prep), now, now, now);
for (const u of [owner, prep]) sdb.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1 WHERE id = ?").run(uid(u));
sdb.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId);

// A policy prepared and submitted by the admin, so the owner has one to approve.
const base = `/api/labs/${labId}/veritapolicy`;
const fd = new FormData();
fd.append("file", new Blob(["<html><body><h1>Point of Care Testing</h1><p>Test policy.</p></body></html>"], { type: "text/html" }), "poct.html");
fd.append("title", "Point of Care Testing");
const up = await call("POST", `${base}/documents`, fd, prep.token, true);
const wf = (await call("GET", `${base}/workflows`, undefined, owner.token)).body.workflows || [];
const wfId = (wf.find((w) => w.is_default) || wf[0])?.id;
const sub = await call("POST", `${base}/documents/${up.body.id}/submit`, { workflowId: wfId }, prep.token);
check("setup: admin uploaded and submitted a policy", (up.status === 200 || up.status === 201) && sub.status === 200, `upload ${up.status}, workflow ${wfId}, submit ${sub.status}`);

const me = (await call("GET", "/api/auth/me", undefined, owner.token)).body;
async function open(path, scheme = "light") {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: scheme });
  await page.goto(`${BASE}/`);
  await page.evaluate(([t, x]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(x)); }, [owner.token, me.user ?? me]);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  return { browser, page };
}

let { browser, page } = await open(`/labs/${labId}/veritapolicy-app/my-policies`);
let text = await page.locator("body").innerText();
check("My Documents subtitle says approval with e-signature and read-and-sign", text.includes("route each one through review and approval with electronic") && text.includes("assign read-and-sign to your staff"));
check("My Documents no longer says 'Phase 1 ships' or 'Phases 2+'", !/Phase 1\s+ships|Phases 2\+/.test(text));
await page.screenshot({ path: `${OUT}/policy_copy_mydocs.png`, fullPage: false });
await page.getByRole("button", { name: "Approve", exact: true }).first().click();
await page.getByRole("dialog").waitFor();
await page.waitForTimeout(600); // let the dialog finish fading in before the screenshot
const dlg = await page.getByRole("dialog").innerText();
check("Approve dialog explains the typed-name e-signature", dlg.includes("recorded as your electronic signature for this approval step"));
check("Approve dialog no longer mentions 'Phase 3'", !/Phase 3/.test(dlg) && !/password re-auth/.test(dlg), dlg.slice(0, 160).replace(/\s+/g, " "));
await page.screenshot({ path: `${OUT}/policy_copy_approve.png`, fullPage: false });
await browser.close();

({ browser, page } = await open(`/labs/${labId}/veritapolicy-app/compliance`, "dark"));
text = await page.locator("body").innerText();
check("Compliance dashboard no longer says 'Phase 6B'", text.includes("Numbers refresh every minute.") && !/Phase 6B/.test(text));
await page.screenshot({ path: `${OUT}/policy_copy_compliance_dark.png`, fullPage: false });
await browser.close();

console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
