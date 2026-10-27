// scripts/verify-registered-marks-pages-ui.mjs
// Gate 3 step 8 browser receipt for the 2026-10-27 registered-mark gaps (Michael Q16 = 1, Q23 = 1; VLS Legal rule that
// VeritaAssure is registered for the software only). Loads the built site and checks:
//   1. Home: the consulting cards read "VeritaAssure(TM) Consulting" / "VeritaAssure(TM) Together", the framework
//      paragraph (consulting plus software) keeps TM both times, and the software copy keeps the registered sign.
//   2. Roadmap: "VeritaAssure(TM) Consulting Services".
//   3. Post-analytical article: the "Explore VeritaMap" button carries the registered sign.
//   4. The three downloads and two share images are served (HTTP 200) from this build.
// Usage: PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-registered-marks-pages-ui.mjs
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5197", OUT = process.env.OUT || ".";
const TM = "™", REG = "®";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
const home = await page.innerText("body");
check("home: consulting card reads VeritaAssure TM Consulting", home.includes(`VeritaAssure${TM} Consulting`));
check("home: combined card reads VeritaAssure TM Together", home.includes(`VeritaAssure${TM} Together`));
check("home: framework paragraph keeps TM both times", home.includes(`VeritaAssure${TM} is the compliance framework`) && home.includes(`VeritaAssure${TM} brings the expertise`));
check("home: no registered sign on the consulting cards", !home.includes(`VeritaAssure${REG} Consulting`) && !home.includes(`VeritaAssure${REG} Together`));
check("home: software copy keeps the registered sign (Meet VeritaAssure, Tools card)", home.includes(`Meet VeritaAssure${REG}`) && home.includes(`VeritaAssure${REG} Tools`));
const card = page.getByText(`VeritaAssure${TM} Consulting`, { exact: true }).first();
await card.scrollIntoViewIfNeeded();
const section = card.locator("xpath=ancestor::section[1]");
await (await section.count() ? section : page).screenshot({ path: path.join(OUT, "marks-home-consulting-cards.png") });

await page.goto(`${BASE}/roadmap`, { waitUntil: "networkidle" });
const road = await page.innerText("body");
check("roadmap: VeritaAssure TM Consulting Services", road.includes(`VeritaAssure${TM} Consulting Services`) && !road.includes(`VeritaAssure${REG} Consulting Services`));
const rc = page.getByText(`VeritaAssure${TM} Consulting Services`).first();
await rc.scrollIntoViewIfNeeded();
await page.screenshot({ path: path.join(OUT, "marks-roadmap-consulting.png") });

await page.goto(`${BASE}/resources/post-analytical-critical-values-corrected-reports`, { waitUntil: "networkidle" });
const btn = page.getByRole("link", { name: /Explore VeritaMap/ }).first();
await btn.scrollIntoViewIfNeeded();
const btnText = (await btn.innerText()).replace(/\s+/g, ""); // the sign sits in its own span, laid out beside the text
check("article: Explore VeritaMap button carries the registered sign", btnText.includes(`VeritaMap${REG}`) && !btnText.includes(TM), btnText);
await btn.locator("xpath=..").screenshot({ path: path.join(OUT, "marks-article-veritamap-button.png") });

for (const p of ["/clia-tea-reference-2026.pdf", "/api/downloads/clsi-compliance-matrix", "/api/downloads/software-validation-template", "/og-image.png", "/demo-og.png"]) {
  const r = await page.request.get(`${BASE}${p}`);
  check(`served: ${p}`, r.status() === 200, `HTTP ${r.status()}, ${(await r.body()).length} bytes`);
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
