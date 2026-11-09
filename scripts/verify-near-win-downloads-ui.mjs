// scripts/verify-near-win-downloads-ui.mjs
// Gate 3 receipt for the near-win downloads batch (SEO handoff 2026-11-09, Michael's go Q251 = 1). Local build only:
//   PW_BASE=http://localhost:5196 OUT=<dir> node scripts/verify-near-win-downloads-ui.mjs
// (vls-ops/ui_run_repo_port.sh builds, serves a scratch DB on UI_PORT, and runs this.)
// For each of the three pages (mock inspection, EP26 lot verification, cost per reportable test):
//   1. served HTML (what a crawler reads): the new description in the meta tag and the Article JSON-LD, dateModified
//      2026-11-09, the server title unchanged
//   2. the download file answers 200 with its content type, and its length and bytes equal client/public's copy
//   3. in a browser: after render, document.title equals the served <title> and the meta description equals the served
//      one; the download box sits under the header and above Key Takeaways (or the lede), with the spec's title and
//      description and the right button; the hidden "website" field is in its form, empty, unseen and untabbable;
//      submitting a reserved address (never stored or mailed) shows the box's success state, sends source and an empty
//      website field, and starts the download under the spec's file name, byte for byte the served file
//   4. no em or en dash on the page; no page errors; light, dark and phone width (no sideways scroll), with screenshots
// The mock inspection page also carries the "Book a scoping call" block, before the newsletter signup, linking
// /book/scoping-call; the EP26 page offers no copy of the CLSI EP26 standard; the TEa box keeps "Get the free PDF".
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
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
const PUBLIC = path.resolve("client/public");
const EMAIL = "name@example.test"; // reserved: the endpoint answers success and stores and sends nothing
const MODIFIED = "2026-11-09";

const PAGES = [
  {
    key: "mock",
    path: "/resources/tjc-laboratory-inspection-what-to-expect",
    title: "Laboratory Mock Inspection: A Joint Commission Survey Walkthrough",
    desc: "Rehearse a Joint Commission lab survey before it is real. A former TJC surveyor (200+ inspections) walks each phase. Free mock inspection checklist (PDF).",
    published: "2026-07-20",
    source: "upgrade-mock-checklist",
    asset: "/laboratory-mock-inspection-checklist.pdf",
    assetName: "Laboratory-Mock-Inspection-Checklist.pdf",
    type: "application/pdf",
    boxTitle: "Download the Laboratory Mock Inspection Checklist (PDF)",
    boxDesc: "Every phase of a Joint Commission laboratory survey as a printable checklist: scope, PT, records, tracers, personnel, and close-out. Free.",
    button: "Get the free PDF",
    label: "PDF",
    below: (p) => p.getByText("Key Takeaways", { exact: true }),
  },
  {
    key: "ep26",
    path: "/resources/ep26-reagent-lot-verification",
    title: "CLSI EP26 Reagent Lot Verification: Protocol and How-To Guide",
    desc: "How to verify a new reagent lot under CLSI EP26 (2nd edition): sample count, acceptance criteria, and documentation. Free lot verification log template.",
    published: "2026-06-16",
    source: "upgrade-lot-log",
    asset: "/reagent-control-lot-verification-log.xlsx",
    assetName: "Reagent-Control-Lot-Verification-Log.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    boxTitle: "Download the reagent and control lot verification log (Excel)",
    boxDesc: "A ready-to-use log for every new lot: prior lot, new lot, acceptance criterion set in advance, pass or fail, and sign-off. Free.",
    button: "Get the free Excel log",
    label: "Excel log",
    below: (p) => p.getByText("Key Takeaways", { exact: true }),
  },
  {
    key: "cprt",
    path: "/resources/cost-per-reportable-test-four-layer-framework",
    title: "Cost Per Reportable Test: The Four-Layer CPRT Framework",
    desc: "Calculate your true cost per reportable test with a four-layer model: reagents, labor, equipment, and overhead, built on CLSI GP11-A. Free PDF of the framework.",
    published: "2026-05-28",
    source: "upgrade-cprt-framework",
    asset: "/cost-per-reportable-test-framework.pdf",
    assetName: "Cost-Per-Reportable-Test-Framework.pdf",
    type: "application/pdf",
    boxTitle: "Download the four-layer CPRT framework (PDF)",
    boxDesc: "The full cost-per-reportable-test framework, layer by layer, in a printable PDF for budget and capital meetings. Free.",
    button: "Get the free PDF",
    label: "PDF",
    // No Key Takeaways on this page: the box opens the body, above the lede.
    below: (p) => p.getByText("In twenty-three years of clinical laboratory work", { exact: false }),
    belowName: "the lede",
  },
];

let failures = 0, passes = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (cond) passes++; else failures++;
};
const shots = [];
// Page coordinates (boundingBox() is relative to the viewport, a fullPage clip is relative to the page).
const pageRect = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { y: r.top + window.scrollY, height: r.height }; });
// Bring an element near the top of a phone screen so the whole of it shows.
const scrollTop = (loc, gap = 80) => loc.evaluate((el, g) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - g), gap);
const sha =(buf) => createHash("sha256").update(buf).digest("hex");
const unesc = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&sect;/g, "§");
const lum = (rgb) => {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) || ["0", "0", "0"]).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

const browser = await chromium.launch();
fs.mkdirSync(path.join(OUT, "downloads"), { recursive: true });

for (const P of PAGES) {
  console.log(`\n=== ${P.key}  ${P.path}`);

  // 1. Served HTML, before any script runs
  const res = await fetch(`${BASE}${P.path}`);
  const raw = await res.text();
  const servedTitle = unesc((raw.match(/<title>([^<]*)<\/title>/) || [])[1] || "");
  const servedDesc = unesc((raw.match(/<meta[^>]+name="description"[^>]+content="([^"]*)"/i) || [])[1] || "");
  check(`${P.key} 1a. page answers 200`, res.status === 200, String(res.status));
  check(`${P.key} 1b. served meta description is the new one`, servedDesc === P.desc, servedDesc);
  check(`${P.key} 1c. served title is the server title, unchanged`, servedTitle === P.title, servedTitle);
  const ld = [...raw.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).flat().filter(Boolean);
  const article = ld.find((x) => x["@type"] === "Article");
  check(`${P.key} 1d. Article JSON-LD dateModified ${MODIFIED}, datePublished ${P.published}`, article?.dateModified === MODIFIED && article?.datePublished === P.published, JSON.stringify({ p: article?.datePublished, m: article?.dateModified }));
  check(`${P.key} 1e. Article JSON-LD description is the new one`, article?.description === P.desc, article?.description);

  // 2. The file itself
  const local = fs.readFileSync(path.join(PUBLIC, P.asset.slice(1)));
  const ares = await fetch(`${BASE}${P.asset}`);
  const abuf = Buffer.from(await ares.arrayBuffer());
  check(`${P.key} 2a. ${P.asset} answers 200`, ares.status === 200, String(ares.status));
  check(`${P.key} 2b. content type is ${P.type}`, (ares.headers.get("content-type") || "").startsWith(P.type), ares.headers.get("content-type"));
  check(`${P.key} 2c. Content-Length and body length equal the file (${local.length} bytes)`, Number(ares.headers.get("content-length")) === local.length && abuf.length === local.length, `header ${ares.headers.get("content-length")}, body ${abuf.length}`);
  check(`${P.key} 2d. served bytes are the file's bytes (sha256)`, sha(abuf) === sha(local), sha(abuf).slice(0, 16));

  // 3. In the browser, light, desktop
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${BASE}${P.path}`, { waitUntil: "networkidle" });
  check(`${P.key} 3a. after render, document.title equals the served <title>`, (await page.title()) === servedTitle, await page.title());
  const liveDesc = await page.locator('meta[name="description"]').getAttribute("content");
  check(`${P.key} 3b. after render, the meta description equals the served one`, liveDesc === servedDesc, liveDesc);
  const box = page.getByTestId(`content-upgrade-${P.source}`);
  check(`${P.key} 3c. the download box renders once`, (await box.count()) === 1);
  const boxText = (await box.innerText()).replace(/\s+/g, " ");
  check(`${P.key} 3d. box title is the spec's`, boxText.includes(P.boxTitle), boxText.slice(0, 120));
  check(`${P.key} 3e. box description is the spec's`, boxText.includes(P.boxDesc));
  const btn = box.getByRole("button");
  check(`${P.key} 3f. button reads "${P.button}"`, ((await btn.innerText()) || "").trim() === P.button, (await btn.innerText()).trim());
  const h1Box = await page.locator("h1").first().boundingBox();
  const uBox = await box.boundingBox();
  const belowBox = await P.below(page).first().boundingBox();
  check(`${P.key} 3g. box sits under the header and above ${P.belowName || "Key Takeaways"}`, !!h1Box && !!uBox && !!belowBox && h1Box.y + h1Box.height <= uBox.y && uBox.y + uBox.height <= belowBox.y, JSON.stringify({ h1: h1Box && Math.round(h1Box.y + h1Box.height), box: uBox && [Math.round(uBox.y), Math.round(uBox.y + uBox.height)], next: belowBox && Math.round(belowBox.y) }));
  // Hidden field
  const hp = box.locator('form input[name="website"]');
  const hpWrap = box.locator('form [data-testid="newsletter-honeypot"]');
  const hpInfo = (await hp.count()) === 1 ? await hp.evaluate((el) => ({ value: el.value, tab: el.tabIndex, type: el.type })) : null;
  check(`${P.key} 3h. hidden "website" field is in the box's form, empty, tabIndex -1`, !!hpInfo && hpInfo.value === "" && hpInfo.tab === -1, JSON.stringify(hpInfo));
  check(`${P.key} 3i. hidden field is aria-hidden and not visible`, (await hpWrap.getAttribute("aria-hidden")) === "true" && !(await hp.isVisible()));
  const body = await page.locator("body").innerText();
  check(`${P.key} 3j. no em or en dash on the page`, !/[—–]/.test(body), (body.match(/.{0,40}[—–].{0,40}/) || [""])[0]);
  await page.evaluate(() => window.scrollTo(0, 0));
  const topShot = path.join(OUT, `${P.key}-light-top.png`);
  await page.screenshot({ path: topShot, clip: { x: 0, y: 0, width: 1280, height: Math.round(Math.min(1500, (belowBox?.y || 900) + 120)) }, fullPage: true });
  shots.push(topShot);

  if (P.key === "ep26") {
    const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    const docLinks = hrefs.filter((h) => /\.(pdf|docx?)(\?|$)/i.test(h || ""));
    check("ep26 3k. no link to a copy of the CLSI EP26 standard (no PDF or Word link on the page)", docLinks.length === 0, JSON.stringify(docLinks));
    console.log(`      note: clsi.org links on the page: ${JSON.stringify(hrefs.filter((h) => /clsi\.org/i.test(h || "")))}`);
  }

  if (P.key === "mock") {
    const cta = page.getByTestId("mock-inspection-scoping-call");
    check("mock 4a. scoping-call block renders once", (await cta.count()) === 1);
    const ctaText = (await cta.innerText()).replace(/\s+/g, " ").trim();
    check("mock 4b. block reads as the spec", ctaText.includes("Want an independent reviewer?") && ctaText.includes("Veritas Lab Services runs full mock inspections, phase by phase, the way a surveyor does.") && ctaText.includes("Book a scoping call"), ctaText);
    const link = cta.getByRole("link", { name: /Book a scoping call/ });
    check("mock 4c. link goes to /book/scoping-call", (await link.getAttribute("href")) === "/book/scoping-call", await link.getAttribute("href"));
    const nl = page.getByText("The Lab Director's Briefing", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    const faqH = page.getByRole("heading", { name: "Frequently Asked Questions" });
    const [cB, nB, fB] = [await cta.boundingBox(), await nl.boundingBox(), await faqH.boundingBox()];
    check("mock 4d. block sits after the FAQ and before the newsletter signup", !!cB && !!nB && !!fB && fB.y < cB.y && cB.y + cB.height <= nB.y, JSON.stringify({ faq: fB?.y, block: cB?.y, newsletter: nB?.y }));
    const [cR, nR] = [await pageRect(cta), await pageRect(nl)];
    const ctaShot = path.join(OUT, "mock-scoping-light.png");
    await page.screenshot({ path: ctaShot, clip: { x: 0, y: Math.max(0, Math.round(cR.y - 140)), width: 1280, height: Math.round(nR.y + nR.height - cR.y + 180) }, fullPage: true });
    shots.push(ctaShot);
    // The existing in-article call to action on the same page, which the new block copies, for comparison
    const existing = page.getByText("keeps your lab survey-ready", { exact: false }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]");
    const eR = await pageRect(existing);
    const exShot = path.join(OUT, "mock-existing-cta-light.png");
    await page.screenshot({ path: exShot, clip: { x: 0, y: Math.max(0, Math.round(eR.y - 40)), width: 1280, height: Math.round(eR.height + 80) }, fullPage: true });
    shots.push(exShot);
    check("mock 4g. the new block has the same box classes as the existing call to action", (await cta.getAttribute("class")) === (await existing.getAttribute("class")), await cta.getAttribute("class"));
    const served = await fetch(`${BASE}/book/scoping-call`);
    const servedHtml = await served.text();
    check("mock 4e. /book/scoping-call is a live route (200, its own title)", served.status === 200 && /<title>Book a Scoping Call/.test(servedHtml), (servedHtml.match(/<title>[^<]*/) || [""])[0]);
    // Follow the link in the browser. The scheduling API is blocked so nothing reaches a calendar.
    const nav = await ctx.newPage();
    await nav.route("**/api/scheduling/**", (r) => r.abort());
    await nav.goto(`${BASE}${P.path}`, { waitUntil: "networkidle" });
    await nav.getByTestId("mock-inspection-scoping-call").getByRole("link").click();
    await nav.waitForURL("**/book/scoping-call");
    // The URL changes before the lazily loaded page renders, so wait for its own heading, not the old one.
    const h1 = await nav.getByRole("heading", { level: 1, name: /Scoping Call/i }).innerText({ timeout: 15000 }).catch(() => nav.locator("h1").first().innerText().catch(() => ""));
    check("mock 4f. clicking it opens the scoping-call page", new URL(nav.url()).pathname === "/book/scoping-call" && /Scoping Call/i.test(h1), `${new URL(nav.url()).pathname} | ${h1}`);
    await nav.close();
  }

  // Submit the box with a reserved address
  await box.scrollIntoViewIfNeeded();
  await box.getByRole("textbox", { name: "Work email" }).fill(EMAIL);
  const reqP = page.waitForRequest((r) => r.url().endsWith("/api/newsletter/subscribe") && r.method() === "POST");
  const respP = page.waitForResponse((r) => r.url().endsWith("/api/newsletter/subscribe"));
  const dlP = page.waitForEvent("download", { timeout: 15000 });
  await btn.click();
  const [req, resp, dl] = await Promise.all([reqP, respP, dlP.catch((e) => null)]);
  const sent = req.postDataJSON();
  check(`${P.key} 5a. the post carries source ${P.source} and an empty website field`, sent.source === P.source && sent.website === "" && sent.email === EMAIL, JSON.stringify(sent));
  const rj = await resp.json().catch(() => ({}));
  check(`${P.key} 5b. the endpoint answers success`, resp.status() === 200 && rj.success === true, `${resp.status()} ${JSON.stringify(rj)}`);
  const done = page.getByTestId("content-upgrade-done");
  await done.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  check(`${P.key} 5c. the box shows its success state`, await done.isVisible(), (await done.innerText().catch(() => "")).replace(/\s+/g, " "));
  check(`${P.key} 5d. the download starts under the name ${P.assetName}`, !!dl && dl.suggestedFilename() === P.assetName, dl ? dl.suggestedFilename() : "no download event");
  if (dl) {
    const saved = path.join(OUT, "downloads", dl.suggestedFilename());
    await dl.saveAs(saved);
    const got = fs.readFileSync(saved);
    check(`${P.key} 5e. the downloaded file is the served file, byte for byte`, got.length === local.length && sha(got) === sha(local), `${got.length} bytes`);
  }
  const again = done.getByRole("link");
  check(`${P.key} 5f. the "click here" link offers the same file again`, (await again.getAttribute("href")) === P.asset && (await again.getAttribute("download")) === P.assetName && (await again.innerText()).trim() === `click here to download the ${P.label}`, `${await again.getAttribute("href")} | ${await again.getAttribute("download")} | ${(await again.innerText()).trim()}`);
  const doneShot = path.join(OUT, `${P.key}-light-done.png`);
  const dR = await pageRect(done);
  await page.screenshot({ path: doneShot, clip: { x: 0, y: Math.max(0, Math.round(dR.y - 60)), width: 1280, height: Math.round(dR.height + 120) }, fullPage: true });
  shots.push(doneShot);
  check(`${P.key} 5g. no page errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();

  // Dark
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  const dark = await dctx.newPage();
  await dark.goto(`${BASE}${P.path}`, { waitUntil: "networkidle" });
  check(`${P.key} 6a. dark: the page is in dark mode`, await dark.evaluate(() => document.documentElement.classList.contains("dark")));
  const dbox = dark.getByTestId(`content-upgrade-${P.source}`);
  const colors = await dbox.evaluate((el) => {
    const desc = el.querySelectorAll("p")[1];
    return { title: getComputedStyle(el.querySelector("p")).color, desc: getComputedStyle(desc).color, bg: getComputedStyle(document.body).backgroundColor };
  });
  const [ct, cd] = [contrast(colors.title, colors.bg), contrast(colors.desc, colors.bg)];
  check(`${P.key} 6b. dark: box title and description read on the dark page (contrast >= 4.5)`, ct >= 4.5 && cd >= 4.5, `${JSON.stringify(colors)} title ${ct.toFixed(1)} desc ${cd.toFixed(1)}`);
  const dBelow = await P.below(dark).first().boundingBox();
  const darkShot = path.join(OUT, `${P.key}-dark-top.png`);
  await dark.screenshot({ path: darkShot, clip: { x: 0, y: 0, width: 1280, height: Math.round(Math.min(1500, (dBelow?.y || 900) + 120)) }, fullPage: true });
  shots.push(darkShot);
  if (P.key === "mock") {
    const dcta = dark.getByTestId("mock-inspection-scoping-call");
    const dctaColor = await dcta.evaluate((el) => ({ title: getComputedStyle(el.querySelector("div.font-semibold")).color, text: getComputedStyle(el.querySelector("p")).color, bg: getComputedStyle(document.body).backgroundColor }));
    check("mock 6c. dark: scoping-call block reads on the dark page (contrast >= 4.5)", contrast(dctaColor.title, dctaColor.bg) >= 4.5 && contrast(dctaColor.text, dctaColor.bg) >= 4.5, JSON.stringify(dctaColor));
    const cR = await pageRect(dcta);
    const dShot = path.join(OUT, "mock-scoping-dark.png");
    await dark.screenshot({ path: dShot, clip: { x: 0, y: Math.max(0, Math.round(cR.y - 140)), width: 1280, height: Math.round(cR.height + 360) }, fullPage: true });
    shots.push(dShot);
  }
  await dctx.close();

  // Phone
  const pctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const phone = await pctx.newPage();
  await phone.goto(`${BASE}${P.path}`, { waitUntil: "networkidle" });
  check(`${P.key} 7a. phone: no sideways scroll`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await phone.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
  const pbox = phone.getByTestId(`content-upgrade-${P.source}`);
  const pb = await pbox.boundingBox();
  check(`${P.key} 7b. phone: the box fits the screen`, !!pb && pb.x >= 0 && pb.x + pb.width <= 375 + 1, JSON.stringify(pb));
  await scrollTop(pbox);
  const phoneShot = path.join(OUT, `${P.key}-phone.png`);
  await phone.screenshot({ path: phoneShot });
  shots.push(phoneShot);
  if (P.key === "mock") {
    const pcta = phone.getByTestId("mock-inspection-scoping-call");
    await scrollTop(pcta);
    const pShot = path.join(OUT, "mock-scoping-phone.png");
    await phone.screenshot({ path: pShot });
    shots.push(pShot);
  }
  await pctx.close();
}

// The TEa box, which shares the component, still says PDF
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/resources/clia-tea-what-lab-directors-dont-know`, { waitUntil: "networkidle" });
  const t = (await page.getByTestId("content-upgrade-upgrade-tea-table").getByRole("button").innerText()).trim();
  check("tea 8a. the TEa box button still reads Get the free PDF", t === "Get the free PDF", t);
  await ctx.close();
}

await browser.close();
console.log(`\nScreenshots:\n${shots.map((s) => "  " + path.resolve(s)).join("\n")}`);
console.log(failures ? `\n${passes} passed, ${failures} FAILED` : `\nALL PASS (${passes} of ${passes})`);
process.exit(failures ? 1 : 0);
