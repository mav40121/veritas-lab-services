// scripts/verify-dompurify-quiz-sanitize.mjs
// Browser receipt for the DOMPurify update (dependency advisories PR, 2026-10-25). VeritaComp renders HTML quiz
// prompts (question_format = 'html') through DOMPurify with QUIZ_PROMPT_SANITIZER_CONFIG
// (client/src/pages/VeritaCompAppPage.tsx). This loads the INSTALLED dompurify into a real Chromium page and checks
// that a blood-bank reaction table still renders while script, event handlers, javascript: links, images and
// iframes are stripped. Then, when PW_BASE is set, it loads the built app's public pages and fails on console errors.
//   node scripts/verify-dompurify-quiz-sanitize.mjs            (sanitizer only)
//   PW_BASE=http://localhost:5198 node scripts/verify-dompurify-quiz-sanitize.mjs
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const purifyPath = require.resolve("dompurify/dist/purify.min.js");
const version = JSON.parse(fs.readFileSync(path.join(path.dirname(purifyPath), "..", "package.json"), "utf8")).version;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const CONFIG = {
  ALLOWED_TAGS: ["p", "br", "strong", "em", "b", "i", "u", "span", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "ul", "ol", "li", "code", "pre"],
  ALLOWED_ATTR: ["class", "colspan", "rowspan", "scope"],
  ALLOW_DATA_ATTR: false,
};
const PROMPT = `<p>Interpret the <strong>reaction</strong> pattern:</p>
<table><thead><tr><th scope="col">Anti-A</th><th scope="col">Anti-B</th></tr></thead><tbody><tr><td colspan="1">4+</td><td>0</td></tr></tbody></table>
<script>window.__pwned = 1</script><img src="x" onerror="window.__pwned = 2"><a href="javascript:window.__pwned=3">link</a>
<span onclick="window.__pwned=4" class="note">click</span><iframe src="https://example.com"></iframe>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<!doctype html><html><body><div id=out></div></body></html>");
await page.addScriptTag({ path: purifyPath });
const r = await page.evaluate(([html, cfg]) => {
  const clean = window.DOMPurify.sanitize(html, cfg);
  const out = document.getElementById("out");
  out.innerHTML = clean;
  out.querySelector("span")?.click();
  return {
    clean,
    cells: out.querySelectorAll("td").length,
    headers: out.querySelectorAll("th").length,
    pwned: window.__pwned || 0,
    hasImg: !!out.querySelector("img"),
    hasIframe: !!out.querySelector("iframe"),
    hasScript: !!out.querySelector("script"),
    hasHandler: /on\w+=/i.test(clean),
    hasJsUrl: /javascript:/i.test(clean),
  };
}, [PROMPT, CONFIG]);
await new Promise((res) => setTimeout(res, 300));
const pwnedAfter = await page.evaluate(() => window.__pwned || 0);
check(`dompurify ${version}: the reaction table survives (2 header cells, 2 data cells)`, r.headers === 2 && r.cells === 2, JSON.stringify({ th: r.headers, td: r.cells }));
check("script, image, iframe and event handlers are stripped", !r.hasScript && !r.hasImg && !r.hasIframe && !r.hasHandler, r.clean.slice(0, 200));
check("javascript: links are stripped", !r.hasJsUrl);
check("no injected code ran", r.pwned === 0 && pwnedAfter === 0, `pwned=${pwnedAfter}`);

if (process.env.PW_BASE) {
  const BASE = process.env.PW_BASE;
  for (const p of ["/", "/login", "/demo", "/pricing"]) {
    const pg = await browser.newPage();
    const errors = [];
    pg.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/i.test(m.text())) errors.push(m.text().slice(0, 160)); });
    pg.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
    const resp = await pg.goto(BASE + p, { waitUntil: "networkidle" });
    check(`built app ${p} loads without script errors`, (resp?.status() || 0) < 400 && errors.length === 0, `status=${resp?.status()} ${errors.join(" | ")}`);
    await pg.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
