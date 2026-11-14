// scripts/verify-seo-title-parity-ui.mjs
// Gate 3 receipt for the title parity fix (SEO handoff 2026-11-09, Part 1). Local build only:
//   PW_BASE=http://localhost:5195 OUT=<dir> node scripts/verify-seo-title-parity-ui.mjs
// (vls-ops/ui_run_repo_port.sh builds, serves a scratch DB on UI_PORT, and runs this.)
// For each route whose title or description this change aligned, plus mock inspection and CPRT (aligned on the base
// branch, PR 1864):
//   1. served HTML (what a crawler that runs no script reads): 200, and the <title> and meta description are the
//      values chosen for the route
//   2. in Chromium: useSEO really ran (setters on document.title and the description meta record every write, so a
//      page that never called it can't pass on the served HTML alone), every write equals the served value, and after
//      render document.title and the one meta description equal the served ones
//   3. no page errors; no em or en dash in either value
// It only loads pages (GET); it submits no form.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const BASE = process.env.PW_BASE || "";
const OUT = process.env.OUT || ".";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error("Refusing to run: PW_BASE must be a local build (localhost or 127.0.0.1).");
  process.exit(2);
}

// The value that won for each route (server kept for resource pages and /veritaassure; the more recently edited side
// for /book/scoping-call and /demo/*; server, also the more recent, for /services, /faq, /resources and /veritabench).
const ROUTES = [
  { path: "/veritaassure", title: "VeritaAssure® | Lab Compliance Software Suite for Clinical Laboratories", desc: "The complete laboratory compliance platform. VeritaCheck®, VeritaMap®, VeritaScan®, VeritaTrack™, VeritaDC™, and more, built by a former Joint Commission surveyor with 200+ facility inspections." },
  { path: "/resources/how-to-perform-method-comparison-study", title: "How to Perform a Method Comparison Study (Clinical Lab, CLIA)", desc: "How to run a method comparison study under CLIA: when it is required, how many specimens, and how to judge bias against your criterion. Free Excel worksheet." },
  { path: "/resources/precision-verification-report-interpretation-guide", title: "Interpret EP15 Precision Reports | Veritas Lab Services", desc: "How to interpret EP15-A3 precision verification reports for CLIA compliance: SD, CV, total imprecision, and what surveyors look for in your documentation." },
  { path: "/resources/laboratory-inventory-management", title: "Laboratory Inventory Management Best Practices | Veritas Lab Services", desc: "Laboratory inventory management guide covering reagent tracking, expiration monitoring, and compliance documentation for CLIA and accreditation surveys." },
  { path: "/resources/manual-logs-why-most-labs-should-stop", title: "Manual Logs: Why Most Labs Should Stop | Veritas Lab Services", desc: "Manual logs were invented to solve a memory problem in labs that had one or two computers. In 2026, the log is the source of the error that transcribed-result review was designed to catch. Here is when to retire it." },
  { path: "/resources/why-veritacheck-vs-legacy-verification", title: "VeritaCheck® vs Legacy Verification | Veritas Lab Services", desc: "How VeritaCheck® improves on legacy EP15, EP09, calibration verification, and method comparison workflows. CFR-cited PDF output, director sign-off." },
  { path: "/resources/veritacheck-vs-ep-evaluator", title: "VeritaCheck® vs EP Evaluator: CLIA Verification Compared", desc: "How VeritaCheck® and EP Evaluator compare for CLIA performance verification: statistical study coverage, 42 CFR citation, whole-menu coverage, reporting, and pricing. An honest side-by-side from a former Joint Commission surveyor." },
  { path: "/resources", title: "Resources | CLIA Compliance Guides for Clinical Laboratories", desc: "Free guides and articles on CLIA compliance, performance verification, calibration verification, proficiency testing, and laboratory inspection preparation." },
  { path: "/book/scoping-call", title: "Book a 50-Minute Scoping Call | Veritas Lab Services", desc: "Schedule a no-cost 50-minute scoping call with Michael Veri to confirm engagement fit, scope, and price before any paper changes hands." },
  { path: "/demo/operations", title: "Operations Demo - Lab Productivity & Staffing Tools | VeritaAssure®", desc: "See the operations modules in action. Interactive VeritaBench™ scorecard, VeritaPace™ monthly tracking, VeritaShift™ by-hour staffing, VeritaStock™ inventory, and VeritaOps™ cost per reportable test." },
  { path: "/demo/cprt", title: "VeritaOps™ CPRT Demo: Cost Per Reportable Test", desc: "Interactive demo of the CPRT (Cost-Per-Reportable-Test) four-layer framework built on CLSI GP11-A. Lab director and CFO perspective in one workspace." },
  { path: "/demo/qc", title: "VeritaQC™ Demo: Westgard QC + Monthly Attestation", desc: "Walkthrough of VeritaQC™: daily QC entry, Westgard rule evaluation, corrective action capture, and monthly review attestation. Phase 1 preview." },
  { path: "/services", title: "Services | Veritas Lab Services Laboratory Consulting", desc: "Laboratory consulting led by Michael Veri, MS, MBA, MLS(ASCP), CPHQ, a former TJC Laboratory Surveyor. Mock inspections, productivity analysis, director coverage, and leadership coaching." },
  { path: "/faq", title: "FAQ | VeritaAssure® Lab Compliance Software", desc: "Frequently asked questions about VeritaAssure®, CLIA compliance software, performance verification, and laboratory inspection readiness tools." },
  { path: "/veritabench", title: "VeritaPace™ | Monthly Lab Productivity Tracker | VeritaAssure®", desc: "Track monthly lab productivity with VeritaPace™. Productive hours per billable test against facility-type ranges, FTE and overtime analysis, and year-over-year trend. Included with VeritaAssure® Suite plans." },
  { path: "/resources/tjc-laboratory-inspection-what-to-expect", base: true, title: "Laboratory Mock Inspection: A Joint Commission Survey Walkthrough", desc: "Rehearse a Joint Commission lab survey before it is real. A former TJC surveyor (200+ inspections) walks each phase. Free mock inspection checklist (PDF)." },
  { path: "/resources/cost-per-reportable-test-four-layer-framework", base: true, title: "Cost Per Reportable Test: The Four-Layer CPRT Framework", desc: "Calculate your true cost per reportable test with a four-layer model: reagents, labor, equipment, and overhead, built on CLSI GP11-A. Free PDF of the framework." },
];

let failures = 0, passes = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (cond) passes++; else failures++;
};
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&sect;/g, "§");

// Record every script write to document.title and to the description meta's content, before any page script runs.
function recordSeoWrites() {
  window.__seoWrites = { title: [], desc: [] };
  const td = Object.getOwnPropertyDescriptor(Document.prototype, "title");
  Object.defineProperty(document, "title", {
    configurable: true,
    get() { return td.get.call(this); },
    set(v) { window.__seoWrites.title.push(String(v)); td.set.call(this, v); },
  });
  const cd = Object.getOwnPropertyDescriptor(HTMLMetaElement.prototype, "content");
  Object.defineProperty(HTMLMetaElement.prototype, "content", {
    configurable: true,
    get() { return cd.get.call(this); },
    set(v) { if (this.name === "description") window.__seoWrites.desc.push(String(v)); cd.set.call(this, v); },
  });
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const summary = [];

for (const R of ROUTES) {
  const key = R.path;
  console.log(`\n=== ${key}${R.base ? "  (aligned on the base branch)" : ""}`);

  // 1. Served HTML, before any script runs
  const res = await fetch(`${BASE}${R.path}`);
  const raw = await res.text();
  const servedTitle = unesc((raw.match(/<title>([^<]*)<\/title>/) || [])[1] || "");
  const servedDesc = unesc((raw.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) || [])[1] || "");
  check(`${key} 1a. page answers 200`, res.status === 200, String(res.status));
  check(`${key} 1b. served <title> is the chosen title`, servedTitle === R.title, servedTitle);
  check(`${key} 1c. served meta description is the chosen description`, servedDesc === R.desc, servedDesc);

  // 2. In the browser
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(recordSeoWrites);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}${R.path}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__seoWrites.title.length > 0 && window.__seoWrites.desc.length > 0, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500); // let any later effect land before reading the final state
  const writes = await page.evaluate(() => window.__seoWrites);
  const liveTitle = await page.title();
  const metas = await page.locator('meta[name="description"]').evaluateAll((els) => els.map((e) => e.getAttribute("content")));
  check(`${key} 2a. useSEO ran: the page wrote document.title and the meta description`, writes.title.length > 0 && writes.desc.length > 0, `title writes ${writes.title.length}, description writes ${writes.desc.length}`);
  check(`${key} 2b. every title write equals the served <title>`, writes.title.length > 0 && writes.title.every((t) => t === servedTitle), JSON.stringify(writes.title));
  check(`${key} 2c. every description write equals the served description`, writes.desc.length > 0 && writes.desc.every((d) => d === servedDesc), writes.desc.length === 1 ? "" : JSON.stringify(writes.desc));
  check(`${key} 2d. after render, document.title equals the served <title>`, liveTitle === servedTitle, liveTitle);
  check(`${key} 2e. after render, the one meta description equals the served one`, metas.length === 1 && metas[0] === servedDesc, metas.length === 1 ? "" : `${metas.length} tags`);

  // 3. Errors and copy
  check(`${key} 3a. no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  check(`${key} 3b. no em or en dash in the title or description`, !/[—–]/.test(servedTitle + servedDesc));
  summary.push({ path: R.path, servedTitle, servedDesc, renderedTitle: liveTitle, renderedDesc: metas[0] ?? null, titleWrites: writes.title, descWrites: writes.desc.length, errors });
  // A picture for the PR: the rendered page with its live title and description read back into a banner at the top.
  // Taken after every check above, so the banner can't affect them.
  if (["/veritaassure", "/book/scoping-call"].includes(R.path)) {
    await page.evaluate(([t, d]) => {
      const b = document.createElement("div");
      b.setAttribute("style", "position:fixed;top:0;left:0;right:0;z-index:99999;background:#0A3A3D;color:#fff;font:13px/1.4 system-ui;padding:8px 12px");
      b.textContent = `document.title: ${t}  |  meta description: ${d}`;
      document.body.appendChild(b);
    }, [liveTitle, metas[0] ?? ""]);
    await page.screenshot({ path: path.join(OUT, `seo-title-parity${R.path.replace(/\//g, "-")}.png`) });
  }
  await ctx.close();
}

await browser.close();
const out = path.join(OUT, "seo-title-parity-ui.json");
fs.writeFileSync(out, JSON.stringify(summary, null, 2));
console.log(`\nPer-route values: ${path.resolve(out)}`);
console.log(failures ? `\n${passes} passed, ${failures} FAILED` : `\nALL PASS (${passes} of ${passes})`);
process.exit(failures ? 1 : 0);
