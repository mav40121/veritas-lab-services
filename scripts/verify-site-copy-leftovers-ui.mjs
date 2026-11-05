// scripts/verify-site-copy-leftovers-ui.mjs
// Gate 3 receipt for the last copy group of the 2026-11-05 site review: crawler text, the Why VeritaCheck PDF, and in-app wording.
//   PW_BASE=http://localhost:5197 OUT=<dir> node scripts/verify-site-copy-leftovers-ui.mjs
// Raw HTML first (what a crawler reads), then a real browser. On a local build it also shows logged-in text and two downloads,
// using a fake user in localStorage and browser-mocked /api answers, so it creates no account. Against any other host it stays
// logged out and read-only.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const BASE = process.env.PW_BASE || "http://localhost:5197", OUT = process.env.OUT || ".";
const LOCAL = /localhost|127\.0\.0\.1/.test(BASE);
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const raw = async (p) => { const r = await fetch(BASE + p, { redirect: "manual" }); return { status: r.status, loc: r.headers.get("location") || "", html: await r.text() }; };

// ---- raw HTML ----
const home = await raw("/");
check("/ JSON-LD: new PT limit feature lines", home.html.includes("evaluated against the criterion your laboratory adopts") && home.html.includes("or a criterion your medical director or designee adopts"));
check("/ JSON-LD: old PT limit lines gone", !home.html.includes("Automatic 42 CFR Part 493") && !home.html.includes("studies with 42 CFR Part 493 total allowable error criteria"));
const graphs = [...home.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
let parsed = 0; for (const g of graphs) { try { JSON.parse(g[1]); parsed++; } catch {} }
check("/ every ld+json block parses", parsed === graphs.length && parsed > 0, `${parsed}/${graphs.length}`);

const blocks = [
  ["/veritacheck", ["is evaluated against the acceptance criterion the laboratory adopts", "laboratory director or designee signature block"], ["criteria automatically", "and the director signature block"]],
  ["/veritamap", ["10 analytes lab-wide"], ["Last Verified"]],
  ["/veritacomp", ["the TJC rule", "to import instruments"], ["auto-import", "auto-complete"]],
  ["/veritadc", ["master list of 58 laboratory policies", "A reference set of citations follows", "88 for The Joint Commission", "286 citations"], ["counts are generated", "whole category"]],
  ["/veritatrack", ["each test's complexity comes from the map", "Regulatory Compliance Calendar"], ["FDA classification", "QC Task Tracking"]],
  ["/veritapt", ["preventive action, and a monitoring plan", "493.1445(e)(4)", "coverage and tracking"], ["effectiveness checks"]],
  ["/veritalab", ["from the CLIA number on your account", "ISO 15189", "Automatic expiration reminders"], ["lookup data", "Configurable"]],
  ["/veritaassure", ["laboratories use to meet 42 CFR Part 493", "cross-referenced to the current TJC standard", "VeritaPT&#8482; coverage"], ["studies required under 42 CFR", "enrollment checks"]],
  ["/resources/clia-tea-lookup", ["CLIA proficiency testing acceptance limits", "published July 11, 2022, effective July 11, 2024"], ["RCPA", "January 1, 2025"]],
  ["/faq", [], ["January 1, 2025"]],
  ["/resources/how-to-validate-veritacheck-clia", ["How to Validate VeritaCheck", "in Your Laboratory", "For a lab whose accreditor", "www.veritaslabservices.com. Sections: Why Document"], ["For most regulated labs", "for CLIA Compliance"]],
  ["/resources/how-to-perform-method-comparison-study", ["twice a year", "about 40 patient specimens"], ["Use a minimum of 40"]],
  ["/resources/calibration-verification-requirements-clia", ["with exceptions CMS lists"], ["for all non-waived quantitative tests"]],
  ["/resources/clia-calibration-verification-method-comparison", ["For a TJC-accredited lab", "The TJC Six-Month-Plus-Twenty-Day Window"], ["built-in 20-day compliance window"]],
  ["/resources/ep26-reagent-lot-verification", ["your medical director or designee adopted"], ["TEa-anchored criterion", "anchored to total allowable error"]],
  ["/resources/verifying-reference-intervals", ["three or four fall outside"], ["three or more fall outside"]],
  ["/resources/veritacheck-vs-ep-evaluator", ["sold by subscription"], ["no concept of", "per-user license plus annual maintenance"]],
  ["/resources/why-veritacheck-vs-legacy-verification", ["installed Windows software"], ["integrated only with itself", "the same verification studies"]],
  ["/resources/manual-logs-why-most-labs-should-stop", ["which some laboratories set at 24 hours"], ["fails CLIA, TJC, and CAP audits", "often set at 24 hours"]],
  ["/resources/laboratory-inventory-management", ["built to prevent stockouts", "CLIA requires sufficient"], ["eliminates stockouts", "3 to 5 days"]],
  ["/resources/how-veritaassure-trains-lab-leaders", ["the book, coming soon"], ["form a complete leadership curriculum"]],
];
for (const [route, want, gone] of blocks) {
  const { status, html } = await raw(route);
  check(`${route} 200`, status === 200, String(status));
  for (const s of want) check(`${route} raw has: ${s}`, html.includes(s));
  for (const s of gone) check(`${route} raw lacks: ${s}`, !html.includes(s));
}
const ops = await raw("/operations");
check("/operations 301 to /veritaassure", ops.status === 301 && ops.loc.endsWith("/veritaassure"), `${ops.status} ${ops.loc}`);
check("/sitemap.xml does not list /operations", !(await raw("/sitemap.xml")).html.includes("/operations<"));

// ---- browser, logged out ----
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
const text = async (p, waitFor) => {
  await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
  if (waitFor) await page.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate(() => document.body.innerText);
};

let t = await text("/veritaops-app", "Sign in to use VeritaOps");
check("/veritaops-app logged out: gate", t.includes("Sign in to use VeritaOps"));
await page.getByRole("link", { name: "See the CPRT demo" }).click();
await page.waitForURL("**/demo/cprt", { timeout: 15000 }).catch(() => {});
check("/veritaops-app CPRT demo link lands on /demo/cprt", page.url().endsWith("/demo/cprt"), page.url());
await text("/veritaops-app", "Sign in to use VeritaOps");
await page.getByRole("link", { name: "Sign in", exact: true }).last().click();
await page.waitForURL("**/login**", { timeout: 15000 }).catch(() => {});
check("/veritaops-app Sign in link lands on /login", page.url().includes("/login"), page.url());

t = await text("/veritaresponse", "Post-survey deficiency response");
check("/veritaresponse logged out: Clinic wording", t.includes("included in Clinic ($999/yr) and above"));
check("/veritaresponse logged out: no all-paid-plans wording", !t.includes("all paid plans"));
await page.getByRole("link", { name: "See plans" }).click();
await page.waitForURL("**/pricing", { timeout: 15000 }).catch(() => {});
check("/veritaresponse See plans lands on /pricing", page.url().endsWith("/pricing"), page.url());

t = await text("/veritapt", "Close the Loop on Failures");
check("/veritapt: corrective action cites the director duty", t.includes("Corrective action is required under 42 CFR 493.1236, 493.1407(e)(4), and 493.1445(e)(4)"));
check("/veritapt: Subpart H line gone", !t.includes("Part 493 Subpart H"));
await page.getByText("Close the Loop on Failures").first().scrollIntoViewIfNeeded();
await page.screenshot({ path: `${OUT}/site-left-pt.png` });

t = await text("/services", "CLIA PT limit presets");
check("/services PT limit line", t.includes("CLIA PT limit presets for major analytes or a criterion your director adopts"));
t = await text("/resources", "CLIA publishes a PT acceptance limit");
check("/resources TEa card", t.includes("CLIA publishes a PT acceptance limit a medical director or designee may adopt"));
check("/resources old TEa card gone", !t.includes("regulatory standard lives in federal law"));
check("/resources lookup card", !t.includes("complete 2025"));
await page.screenshot({ path: `${OUT}/site-left-resources.png` });

await text("/", "See a sample report");
const blurb = page.getByText("here a CLIA PT limit", { exact: false });
check("/ precision sample blurb", (await blurb.count()) > 0);
if (await blurb.count()) { await blurb.first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/site-left-home-samples.png` }); }

await page.goto(BASE + "/operations", { waitUntil: "domcontentloaded" });
await page.waitForURL("**/veritaassure", { timeout: 15000 }).catch(() => {});
check("/operations lands on /veritaassure in the browser", page.url().endsWith("/veritaassure"), page.url());

// Dark and phone, logged out
const darkCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const dark = await darkCtx.newPage();
await dark.goto(`${BASE}/`);
await dark.evaluate(() => localStorage.setItem("theme", "dark"));
await dark.goto(`${BASE}/veritapt`, { waitUntil: "networkidle" });
await dark.screenshot({ path: `${OUT}/site-left-pt-dark.png` });
const phoneCtx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const phone = await phoneCtx.newPage();
for (const p of ["/veritaops-app", "/veritaresponse", "/veritapt"]) {
  await phone.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  check(`phone ${p}: no sideways scroll`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
}
await phone.goto(`${BASE}/veritaops-app`, { waitUntil: "networkidle" });
await phone.screenshot({ path: `${OUT}/site-left-ops-phone.png` });

// ---- local build only: the Why PDF, logged-in text and download names ----
if (LOCAL) {
  await text("/resources/why-veritacheck-vs-legacy-verification", "installed Windows software");
  const [why] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    page.getByRole("button", { name: /pdf/i }).first().click(),
  ]);
  check("Why PDF: download name", /^Why_VeritaCheck.*\.pdf$/.test(why.suggestedFilename()), why.suggestedFilename());
  await why.saveAs(`${OUT}/site-left-why.pdf`);
  check("Why PDF: file is a PDF", readFileSync(`${OUT}/site-left-why.pdf`).subarray(0, 4).toString() === "%PDF");

  const fake = (plan) => ({ id: 999001, email: "local-check@example.test", name: "Local Check", plan, personalPlan: plan, studyCredits: 0, hasCompletedOnboarding: true, onboardingSeen: true, accessLevel: "full", subscriptionExpiresAt: "2099-01-01T00:00:00Z", subscriptionStatus: "active" });
  const signedIn = async (plan) => {
    const c = await browser.newContext({ viewport: { width: 1280, height: 1000 }, acceptDownloads: true });
    await c.addInitScript((u) => { localStorage.setItem("veritas_token", "local-only"); localStorage.setItem("veritas_user", JSON.stringify(u)); }, fake(plan));
    await c.route("**/api/**", (route) => route.request().url().includes("/auth/me") ? route.fulfill({ json: fake(plan) }) : route.fulfill({ status: 200, json: [] }));
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(`${p.url()}: ${e.message}`));
    return { c, p };
  };
  const viewText = async (p, path, waitFor) => {
    await p.goto(BASE + path, { waitUntil: "domcontentloaded" });
    if (waitFor) await p.getByText(waitFor, { exact: false }).first().waitFor({ timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(400);
    return p.evaluate(() => document.body.innerText);
  };
  const openHowTo = async (p) => {
    for (const name of [/how to use/i, /how it works/i, /what this does/i, /show/i]) {
      const b = p.getByRole("button", { name }).first();
      if (await b.count()) { await b.click().catch(() => {}); break; }
    }
    await p.waitForTimeout(200);
    return p.evaluate(() => document.body.innerText);
  };

  {
    const { c, p } = await signedIn("free");
    let x = await viewText(p, "/veritamap-app", "Free plan:");
    check("/veritamap-app free: lab-wide limit", x.includes("up to 4 instruments and 10 analytes lab-wide"));
    x = await viewText(p, "/veritaresponse", "Post-survey deficiency response");
    check("/veritaresponse free user: Clinic wording", x.includes("included in Clinic ($999/yr) and above"));
    check("/veritaresponse free user: Upgrade Plan kept", (await p.getByRole("link", { name: "Upgrade Plan" }).count()) > 0);
    x = await viewText(p, "/veritapt/app", "PT coverage analysis");
    check("/veritapt/app free user: Clinic wording", x.includes("PT coverage analysis is included in Clinic ($999/yr) and above"));
    x = await viewText(p, "/veritalab-app", "VeritaLab");
    check("/veritalab-app free user: Clinic wording", x.includes("VeritaLab™ is included in Clinic ($999/yr) and above"));
    x = await viewText(p, "/veritapolicy-app", "VeritaDC");
    check("/veritapolicy-app free user: Clinic wording", x.includes("is included in Clinic ($999/yr) and above"));
    x = await viewText(p, "/veritastaff-app", "VeritaStaff");
    check("/veritastaff-app free user: Clinic wording", x.includes("requires a Clinic plan or above"));
    x = await viewText(p, "/veritaops-app", "VeritaOps");
    check("/veritaops-app free user: Clinic wording", x.includes("VeritaOps requires a Clinic plan or above"));
    await c.close();
  }
  {
    const { c, p } = await signedIn("clinic");
    await viewText(p, "/veritamap-app", "VeritaMap");
    let x = await openHowTo(p);
    check("/veritamap-app clinic: how-to says library", x.includes("library of 279 analyzers and 34 manual procedures"));
    check("/veritamap-app clinic: no FDA classification", !x.includes("FDA classification") && !x.includes("269"));
    check("/veritamap-app clinic: no Beta badge", !x.includes("Beta"));
    await p.screenshot({ path: `${OUT}/site-left-map-howto.png` });

    x = await viewText(p, "/veritapolicy-app", "Policy Library");
    check("/veritapolicy-app clinic: card points to My Documents", x.includes("route approvals on the My Documents tab"));
    check("/veritapolicy-app clinic: no Coming Soon", !x.includes("Coming Soon"));
    const [report] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), p.getByRole("button", { name: "Download PDF" }).click()]);
    check("VeritaDC report download name", report.suggestedFilename() === "VeritaDC-Report.pdf", report.suggestedFilename());
    const [masterList] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }), p.getByRole("button", { name: "Master List (Excel)" }).click()]);
    check("VeritaDC master list download name", /^VeritaDC_MasterList_.*\.xlsx$/.test(masterList.suggestedFilename()), masterList.suggestedFilename());
    await p.getByText("Policy Library").first().scrollIntoViewIfNeeded().catch(() => {});
    await p.screenshot({ path: `${OUT}/site-left-dc-card.png` });

    await viewText(p, "/veritaops-app", "VeritaOps");
    x = await openHowTo(p);
    check("/veritaops-app clinic: real templates", x.includes("hematology CBC, manual differential, send-out"));
    check("/veritaops-app clinic: developer note gone", !x.includes("v1 feature-complete"));
    check("/veritaops-app clinic: no POCT archetype", !x.includes("POCT, manual coag"));

    await viewText(p, "/veritalab-app", "VeritaLab");
    x = await openHowTo(p);
    check("/veritalab-app clinic: certificate types", x.includes("ISO 15189, state laboratory licenses, lab director licenses, and vendor agreements"));

    await viewText(p, "/veritastaff-app", "VeritaStaff");
    x = await openHowTo(p);
    check("/veritastaff-app clinic: Clinical Consultant", x.includes("Laboratory Director, Clinical Consultant, Technical Consultant"));

    await viewText(p, "/dashboard", "VeritaCheck");
    x = await openHowTo(p);
    check("/dashboard clinic: studies wording", x.includes("runs the studies laboratories use to meet CLIA and CAP requirements"));
    check("/dashboard clinic: adopted criterion step", x.includes("the acceptance criterion your lab adopted"));
    check("/dashboard clinic: no director-signed", !x.includes("director-signed PDF"));
    await p.screenshot({ path: `${OUT}/site-left-dashboard.png` });
    await c.close();
  }
}
check("no uncaught page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);
