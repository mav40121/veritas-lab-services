// Audit: what lab/compliance content actually renders on the VeritaStock website.
// Loads each stock-reachable page (public + authed) and reports which flagged
// terms appear in the rendered body, plus the raw <title>/meta (SEO leakage).
import { chromium } from "@playwright/test";

const BASE = process.env.VS_BASE || "https://veritastock-production.up.railway.app";
const EMAIL = "info@veritaslabservices.com", PASS = "dummycheck123";
const FLAG = ["VeritaAssure", "compliance", "CLIA", "accreditation", "Joint Commission", "inspection", "survey",
  "suite subscription", "Suite plan", "Suite Module", "VeritaCheck", "VeritaComp", "VeritaPolicy", "VeritaScan",
  "VeritaMap", "VeritaLab", "VeritaStaff", "VeritaPT", "VeritaTrack", "VeritaResponse", "VeritaQC"];

async function api(path, opts = {}) {
  const r = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json", ...(opts.headers || {}) }, ...opts });
  try { return { s: r.status, b: await r.json() }; } catch { return { s: r.status, b: null }; }
}
const token = (await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: EMAIL, password: PASS }) })).b?.token;

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 1440, height: 1000 } }).then(c => c.newPage());

// raw <title>/meta of the homepage (server-injected SEO) — seen in tab + search + shares
const rawHome = await (await fetch(`${BASE}/`)).text();
const title = (rawHome.match(/<title>([^<]*)<\/title>/) || [])[1] || "(none)";
const desc = (rawHome.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "(none)";
const ogtitle = (rawHome.match(/<meta property="og:title" content="([^"]*)"/) || [])[1] || "(none)";
console.log("=== HOMEPAGE RAW SEO (browser tab / Google / social) ===");
console.log("  <title>:", title);
console.log("  description:", desc.slice(0, 120));
console.log("  og:title:", ogtitle);

// inject auth for the authed routes
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
if (token) {
  const me = await page.evaluate(async ([b, t]) => { const r = await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${t}` } }); return r.ok ? await r.json() : null; }, [BASE, token]);
  const user = me && (me.user || me);
  await page.evaluate(([t, u]) => { localStorage.setItem("veritas_token", t); if (u) localStorage.setItem("veritas_user", JSON.stringify(u)); }, [token, user]);
}

const routes = ["/", "/login", "/account", "/labs/2/veritastock", "/labs/2/veritastock/enterprise", "/labs/2/veritastock/vendors", "/labs/2/members"];
console.log("\n=== RENDERED-BODY LEAKAGE PER PAGE ===");
for (const r of routes) {
  await page.goto(`${BASE}${r}`, { waitUntil: "networkidle", timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1800);
  const tt = await page.title().catch(() => "");
  const body = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
  const hits = FLAG.filter(t => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(body));
  console.log(`\n${r}  [tab title: ${tt}]`);
  console.log("  url after:", page.url().replace(BASE, ""));
  console.log("  leakage terms in body:", hits.length ? hits.join(", ") : "(none)");
}
if (token) await api("/api/auth/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" });
await browser.close();
console.log("\n(logged out)");
