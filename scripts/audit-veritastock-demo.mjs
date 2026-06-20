// scripts/audit-veritastock-demo.mjs
//
// Exhaustive demo audit: visit every VeritaStock route/button as the demo user,
// flag (a) blank/empty pages and (b) lab/clinical/VeritaAssure leakage from the
// CFO + materials-manager lens. Writes screenshots and a findings table.
//
//   PW_BASE=https://veritastock-production.up.railway.app node scripts/audit-veritastock-demo.mjs

import { chromium } from "@playwright/test";
import { mkdirSync } from "fs";

const BASE = process.env.PW_BASE || "https://veritastock-production.up.railway.app";
const OUT = "C:/Users/veril/Desktop/Verita Products/demo-run/audit";

// Leakage: lab/clinical framing that should never appear on the VeritaStock product.
const LEAK = /\b(labs?|laboratory|laboratories|CLIA|VeritaAssure|clinical|accreditor|accreditation|surveyor|competenc\w*|proficiency|westgard|phlebotomy|medical director|laboratory director|reagent)\b/gi;
// Empty-state markers that signal a blank/dead page. "0 items" is intentionally
// NOT here: it shows up in legitimate summary tiles (e.g. "Expiring Soon: 0")
// on a fully populated page. Snap Order starts as an empty order-builder by
// design, so its build-an-order copy is not a dead page either.
const EMPTY = /(add your first|no inventory items|requires an active subscription|coming soon|page not found)/i;
// Contexts that are legitimate, not lab-operations leakage:
//  - item names that contain a flagged word (Blood culture, EDTA, etc.)
//  - the parent-company legal name in the copyright footer. VeritaStock is a
//    Veritas Lab Services, LLC product; the footer company name is correct and
//    is not lab-operations framing.
const ALLOW = /Blood culture|EDTA|specimen transport|respiratory test|Veritas Lab Services/i;

const routes = [
  { name: "Warehouse inventory", path: "/labs/2/veritastock", content: true },
  { name: "ED inventory", path: "/labs/3/veritastock", content: true },
  { name: "Bylas inventory", path: "/labs/5/veritastock", content: true },
  { name: "Inpatient inventory", path: "/labs/7/veritastock", content: true },
  { name: "Clinic inventory", path: "/labs/8/veritastock", content: true },
  { name: "Valuation Trends", path: "/labs/2/veritastock/trends", content: true },
  { name: "Enterprise", path: "/labs/2/veritastock/enterprise", content: true },
  { name: "Vendor Directory", path: "/labs/2/veritastock/vendors", content: true },
  { name: "Snap Order", path: "/labs/2/veritastock/snap-order", content: true },
  { name: "Account Settings", path: "/account/settings", content: false },
];

function leaksIn(text) {
  const hits = new Set();
  let m;
  LEAK.lastIndex = 0;
  while ((m = LEAK.exec(text)) !== null) {
    const ctxStart = Math.max(0, m.index - 25);
    const ctx = text.slice(ctxStart, m.index + m[0].length + 25).replace(/\s+/g, " ");
    if (ALLOW.test(ctx)) continue;
    hits.add(`${m[0]} :: ...${ctx}...`);
  }
  return [...hits].slice(0, 6);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const login = await (await fetch(`${BASE}/api/demo/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).json();
  const token = login.token, user = login.user;
  if (!token) { console.log("demo login failed"); process.exit(1); }

  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await p.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); localStorage.setItem("veritas_user", JSON.stringify(u)); }, [token, user]);

  const results = [];
  for (const r of routes) {
    try {
      await p.goto(`${BASE}${r.path}`, { waitUntil: "networkidle", timeout: 45000 });
      await p.waitForTimeout(2500);
      const txt = await p.evaluate(() => document.body.innerText);
      const empty = EMPTY.test(txt);
      const leaks = leaksIn(txt);
      const len = txt.replace(/\s+/g, "").length;
      results.push({ name: r.name, path: r.path, chars: len, blank: r.content && (empty || len < 400), empty_marker: empty, leaks });
      await p.screenshot({ path: `${OUT}/${r.name.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: true });
    } catch (e) {
      results.push({ name: r.name, path: r.path, error: e.message });
    }
  }

  // Add Item form (department dropdown leak check)
  let formLeaks = [];
  try {
    await p.goto(`${BASE}/labs/2/veritastock`, { waitUntil: "networkidle" });
    await p.waitForTimeout(2000);
    await p.getByRole("button", { name: /add item/i }).first().click();
    await p.waitForTimeout(800);
    const formTxt = await p.evaluate(() => document.body.innerText);
    formLeaks = leaksIn(formTxt);
    await p.screenshot({ path: `${OUT}/Add_Item_form.png` });
  } catch (e) { formLeaks = ["form open error: " + e.message]; }

  console.log("=== PAGE AUDIT ===");
  for (const r of results) {
    if (r.error) { console.log(`  FAIL  ${r.name} (${r.path}): ${r.error}`); continue; }
    const flags = [];
    if (r.blank) flags.push("BLANK/EMPTY");
    if (r.leaks.length) flags.push(`LEAK(${r.leaks.length})`);
    console.log(`  ${flags.length ? "FLAG " : "ok   "} ${r.name} | chars=${r.chars}${flags.length ? " | " + flags.join(",") : ""}`);
    for (const l of r.leaks) console.log(`         leak: ${l}`);
  }
  console.log("=== ADD ITEM FORM leaks ===");
  for (const l of formLeaks) console.log("  " + l);
  if (!formLeaks.length) console.log("  none");

  await b.close();
  await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
}
main().catch((e) => { console.log("error", e.message); process.exit(1); });
