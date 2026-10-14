// scripts/verify-veritacomp-per-method-signoff.mjs
//
// Receipt for VeritaComp per-method sign-off (Michael 2026-10-13, Q156 talk-through, Q157 = 1, Q158 = 1): each method
// (instrument) is signed off on its own for each person, by a VeritaStaff person whose role fits the method's
// complexity. LOCAL server + scratch DB only; every person, instrument and competency below is a scratch-DB fixture.
//   1. signer lists: moderate = TC or TS for that specialty (Michael Q159: a TS meets the TC requirements) or the director; high = TS for that specialty, a GS with a signed
//      delegation, or the director; waived = GS, TC, TS or director; ineligible people listed with the reason
//   2. sign is refused while elements are open (409 + list), for an ineligible signer (403), for the person assessed
//      signing their own competency (403, Michael Q163 = 1), for a waived method as
//      "6-month" (400), for a future date (400), for an earlier date without documentation (400), and for a date
//      before the method's last sign-off (400)
//   3. signing one method freezes only that method's items; the person's other methods stay open; the next milestone
//      and due date follow (initial + 6 months for moderate); a new entry for the next competency never touches the
//      signed items
//   4. Unlock reopens the most recent sign-off (items back to the working set) and is refused while next entries exist
//   5. a GS becomes eligible for a high-complexity method only with an active Letter of Delegation for competency
//   6. Competencies owed counts a signed method as assessed; By instrument counts signed and ready-to-sign people
//   7. the record PDF downloads as one record page (sign-off lines on page 1) plus the standard license page
//   8. browser: person page signs a method from the form (eligible signer preselected, ineligible greyed), shows the
//      signed banner and next due; instrument page signs another person; light, dark and 390px, no horizontal scroll
// Run: PW_BASE=http://localhost:5167 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-veritacomp-per-method-signoff.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const { PDFDocument } = require("pdf-lib");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT;
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const addMonths = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); const day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10); };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// ---------- fixture ----------
const email = `pms-${Date.now()}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email, password: "testpass123", name: "Signoff Owner", hipaa_acknowledged: true })).body;
const T = owner.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Per-Method Lab", plan: "hospital" })).body.labId;
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Per-Method Lab", cliaNumber: "11D7654311", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, T)).body.id;
const t = (analyte, specialty, complexity) => ({ analyte, specialty, complexity, active: 1 });
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Beckman Coulter AU5800", category: "Chemistry", tests: [t("Sodium", "General Chemistry", "MODERATE"), t("Potassium", "General Chemistry", "MODERATE")] },
  { name: "Sysmex XN-1000", category: "Hematology", tests: [t("WBC", "Hematology", "MODERATE")] },
  { name: "Manual Differential", category: "Hematology", tests: [t("WBC Differential", "Hematology", "HIGH")] },
  { name: "Siemens CLINITEK Status+", category: "Urinalysis", tests: [t("Urine Glucose", "Urinalysis", "WAIVED")] },
] });
const inst = Object.fromEntries((new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT id, instrument_name FROM veritamap_instruments WHERE map_id = ?").all(mapId)).map((r) => [r.instrument_name, r.id]));
const CHEM = inst["Beckman Coulter AU5800"], XN = inst["Sysmex XN-1000"], DIFF = inst["Manual Differential"], UA = inst["Siemens CLINITEK Status+"];
const emp = async (firstName, lastName, extra = {}) => (await call("POST", `${L}/staff/employees`, { firstName, lastName, title: "MLS", performsTesting: true, highestComplexity: "H", hireDate: "2026-09-08", ...extra }, T)).body.id;
const pat = await emp("Pat", "Alpha"), kim = await emp("Kim", "Bravo");
const jordan = await emp("Jordan", "Rivera", { roles: [{ role: "TC", specialtyNumber: 7 }] });
const taylor = await emp("Taylor", "Brooks", { roles: [{ role: "TS", specialtyNumber: 8 }] });
const sam = await emp("Sam", "Ortiz", { roles: [{ role: "GS" }] });
const morgan = await emp("Morgan", "Chen", { roles: [{ role: "LD" }] });
await call("PUT", `${L}/staff/employees/${pat}/instruments`, { instrumentIds: [CHEM, XN, DIFF, UA] }, T);
await call("PUT", `${L}/staff/employees/${kim}/instruments`, { instrumentIds: [XN] }, T);
check("0. fixture: 4 methods (moderate x2, high, waived), 2 testers, 4 signers", [CHEM, XN, DIFF, UA, pat, kim, jordan, taylor, sam, morgan].every(Boolean));

const els = (tag) => [
  { num: 1, specimenId: `S-${tag}`, observerInitials: "JR", passed: true },
  { num: 2, evidence: "Critical called", date: today, passed: true },
  { num: 3, qcDate: today, passed: true },
  { num: 4, dateObserved: today, observerInitials: "JR", passed: true },
  { num: 5, sampleType: "PT", sampleId: `PT-${tag}`, acceptable: true, passed: true },
  { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
];
const put = (e, i, body) => call("PUT", `${L}/competency/employee/${e}/test-system/${i}`, body, T);
const view = async (e) => (await call("GET", `${L}/competency/employee/${e}`, undefined, T)).body;
const tsOf = (v, i) => (v.testSystems || []).find((x) => x.instrumentId === i) || {};
const sign = (e, i, body) => call("POST", `${L}/competency/employee/${e}/test-system/${i}/sign`, body, T);
const names = (opts, eligible) => opts.filter((o) => o.eligible === eligible).map((o) => o.name).sort().join(", ");

// ---------- 1. signer lists ----------
let v = await view(pat);
const sChem = tsOf(v, CHEM).signers || [], sXn = tsOf(v, XN).signers || [], sDiff = tsOf(v, DIFF).signers || [], sUa = tsOf(v, UA).signers || [];
check("1a. chemistry (moderate): Jordan (chemistry TC) and Morgan (LD) eligible", names(sChem, true) === "Jordan Rivera, Morgan Chen", names(sChem, true));
check("1b. chemistry: Taylor (hematology TS) and Sam (GS) greyed out with reasons",
  names(sChem, false) === "Sam Ortiz, Taylor Brooks" && /Hematology, not Chemistry/.test(sChem.find((o) => o.name === "Taylor Brooks")?.reason || "") && sChem.every((o) => o.eligible || !!o.reason), sChem.filter((o) => !o.eligible).map((o) => `${o.name}: ${o.reason}`).join(" | "));
check("1c. XN-1000 (moderate hematology): Taylor (hematology TS, meets TC) and Morgan eligible; Jordan's TC is chemistry only",
  names(sXn, true) === "Morgan Chen, Taylor Brooks" && sXn.find((o) => o.name === "Taylor Brooks")?.role === "TS" && /Chemistry, not Hematology/.test(sXn.find((o) => o.name === "Jordan Rivera")?.reason || ""), sXn.map((o) => `${o.name}:${o.eligible}`).join(" "));
check("1d. manual diff (high hematology): Taylor (hematology TS) and Morgan eligible; Sam needs a delegation",
  names(sDiff, true) === "Morgan Chen, Taylor Brooks" && /delegation/.test(sDiff.find((o) => o.name === "Sam Ortiz")?.reason || ""), sDiff.map((o) => `${o.name}:${o.eligible}`).join(" "));
check("1e. waived urinalysis: GS, TC, TS and LD all eligible", names(sUa, true) === "Jordan Rivera, Morgan Chen, Sam Ortiz, Taylor Brooks", names(sUa, true));
check("1f. the signer the method calls for is listed first (Jordan, TC, on chemistry)", sChem[0]?.name === "Jordan Rivera" && sChem[0]?.role === "TC");

// ---------- 2. refusals ----------
let r = await sign(pat, CHEM, { signerStaffEmployeeId: jordan });
check("2a. nothing entered yet: sign refused (409)", r.status === 409, `${r.status} ${r.body.error}`);
await put(pat, CHEM, { elements: els("C").slice(0, 4) });
r = await sign(pat, CHEM, { signerStaffEmployeeId: jordan });
check("2b. elements 5 and 6 open: 409 lists them", r.status === 409 && (r.body.incomplete || []).length === 2 && /element 5/.test(r.body.incomplete[0]), JSON.stringify(r.body.incomplete));
await put(pat, CHEM, { elements: els("C") });
r = await sign(pat, CHEM, { signerStaffEmployeeId: taylor });
check("2c. ineligible signer (Taylor, hematology TS, on chemistry): 403 with the reason", r.status === 403 && /Hematology, not Chemistry/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await sign(pat, CHEM, { signerStaffEmployeeId: jordan, signedDate: addMonths(today, 1) });
check("2d. a future date: 400", r.status === 400 && /future/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
r = await sign(pat, CHEM, { signerStaffEmployeeId: jordan, signedDate: addMonths(today, -1) });
check("2e. an earlier date without documentation: 400", r.status === 400 && /documentation/i.test(r.body.error || ""), `${r.status} ${r.body.error}`);
await put(pat, UA, { waivedMethods: [{ num: 1, evidence: "Blind BS-1", date: today, initials: "SO", passed: true }, { num: 4, evidence: "Written test", date: today, initials: "SO", passed: true }] });
r = await sign(pat, UA, { signerStaffEmployeeId: sam, milestone: "six_month" });
check("2f. a waived method signed as 6-month: 400", r.status === 400 && /Initial or Annual/.test(r.body.error || ""), `${r.status} ${r.body.error}`);

// Q163 = 1: nobody signs their own competency. Taylor (hematology TS) also runs the manual differential.
await call("PUT", `${L}/staff/employees/${taylor}/instruments`, { instrumentIds: [DIFF] }, T);
await put(taylor, DIFF, { elements: els("T") });
const tSelf = (tsOf(await view(taylor), DIFF).signers || []).find((o) => o.name === "Taylor Brooks");
r = await sign(taylor, DIFF, { signerStaffEmployeeId: taylor });
check("2g. Taylor cannot sign Taylor's own manual diff: greyed out, and the server refuses it (403)",
  tSelf && !tSelf.eligible && /own competency/.test(tSelf.reason || "") && r.status === 403 && /own competency/.test(r.body.error || ""), `${tSelf?.reason} / ${r.status} ${r.body.error}`);
r = await sign(taylor, DIFF, { signerStaffEmployeeId: morgan });
check("2h. the director can sign Taylor's manual diff", r.status === 200, `${r.status} ${r.body.error || ""}`);

// ---------- 3. sign one method ----------
await put(pat, XN, { elements: els("X") });
r = await sign(pat, CHEM, { signerStaffEmployeeId: jordan, signerInitials: "JR" });
check("3a. Jordan signs Pat's chemistry initial", r.status === 200 && r.body.milestone === "initial" && r.body.signedDate === today, `${r.status} ${JSON.stringify(r.body)}`);
const chemSignoff = r.body.signoffId;
v = await view(pat);
const c1 = tsOf(v, CHEM), x1 = tsOf(v, XN);
check("3b. chemistry shows Initial signed by Jordan Rivera (TC) today", c1.lastSignoff?.milestone === "initial" && c1.lastSignoff?.signerName === "Jordan Rivera" && c1.lastSignoff?.signerRole === "TC" && c1.signedCurrent === true);
check("3c. chemistry's next competency is the 6-month, due initial + 6 months", c1.nextMilestone === "six_month" && c1.nextDue?.targetDate === addMonths(today, 6), `${c1.nextMilestone} ${c1.nextDue?.targetDate} (expect ${addMonths(today, 6)})`);
check("3d. the signed set is kept on the sign-off (6 PASS) and the working set is empty", (c1.lastSignoff?.elements || []).every((e) => e.status === "pass") && c1.hasData === false && c1.signable === false);
check("3e. Pat's hematology is untouched: still complete, unsigned, ready to sign", x1.complete === true && x1.signable === true && !x1.lastSignoff);
const frozen = () => new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT COUNT(*) n FROM competency_assessment_items WHERE signoff_id = ?").get(chemSignoff).n;
const f0 = frozen();
await put(pat, CHEM, { elements: [{ num: 1, specimenId: "S-6MO", observerInitials: "JR", passed: true }] });
v = await view(pat);
check("3f. entering the 6-month leaves the signed initial items as they were", frozen() === f0 && f0 === 6 && tsOf(v, CHEM).hasData === true && tsOf(v, CHEM).lastSignoff?.milestone === "initial", `frozen ${f0} -> ${frozen()}`);
await put(pat, CHEM, { elements: els("6MO") });
r = await sign(pat, CHEM, { signerStaffEmployeeId: jordan, signedDate: addMonths(today, -2), documentation: "Paper record in the competency binder" });
check("3g. a sign-off dated before the method's last sign-off: 400", r.status === 400 && /cannot be dated earlier/.test(r.body.error || ""), `${r.status} ${r.body.error}`);

// ---------- 4. unlock ----------
r = await call("POST", `${L}/competency/employee/${pat}/test-system/${CHEM}/signoffs/${chemSignoff}/revoke`, {}, T);
check("4a. Unlock refused while the 6-month already has entries", r.status === 409, `${r.status} ${r.body.error}`);
r = await sign(pat, UA, { signerStaffEmployeeId: sam, signerInitials: "SO" });
const uaSignoff = r.body.signoffId;
check("4b. Sam (GS) signs the waived urinalysis initial; next is the annual", r.status === 200 && tsOf(await view(pat), UA).nextMilestone === "annual", `${r.status}`);
r = await call("POST", `${L}/competency/employee/${pat}/test-system/${UA}/signoffs/${uaSignoff}/revoke`, {}, T);
v = await view(pat);
check("4c. Unlock reopens it: no sign-off, the two methods back in the working set, ready to sign again",
  r.status === 200 && !tsOf(v, UA).lastSignoff && tsOf(v, UA).waivedPassed === 2 && tsOf(v, UA).signable === true, `${r.status} ${JSON.stringify({ last: tsOf(v, UA).lastSignoff, p: tsOf(v, UA).waivedPassed })}`);
r = await sign(pat, UA, { signerStaffEmployeeId: sam, signerInitials: "SO" });
check("4d. signed again after the correction", r.status === 200);

// ---------- 5. GS delegation for high complexity ----------
await put(pat, DIFF, { elements: els("D") });
r = await sign(pat, DIFF, { signerStaffEmployeeId: sam });
check("5a. Sam (GS, no delegation) cannot sign the high-complexity manual diff", r.status === 403 && /delegation/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
{ const db = new Database(process.env.SCRATCH_DB); db.prepare(
  "INSERT INTO director_delegations (lab_id, delegate_staff_employee_id, delegate_name, position, complexity_scope, responsibilities_json, status, signed_name, signed_at, created_at, updated_at) VALUES (?, ?, 'Sam Ortiz', 'general_supervisor', 'high', ?, 'active', 'Morgan Chen', ?, ?, ?)"
).run(labId, sam, JSON.stringify({ gs_orientation_training: true }), new Date().toISOString(), new Date().toISOString(), new Date().toISOString()); db.close(); }
v = await view(pat);
check("5b. with an active Letter of Delegation for competency, Sam is eligible as GS", (tsOf(v, DIFF).signers || []).some((o) => o.name === "Sam Ortiz" && o.eligible && o.role === "GS"));

// ---------- 6. rollups ----------
const owed = (await call("GET", `${L}/competency/owed`, undefined, T)).body;
const po = Object.fromEntries(((owed.employees || []).find((e) => e.employeeId === pat)?.owed || []).map((o) => [o.instrumentName, o]));
check("6a. Competencies owed: Pat's signed chemistry and urinalysis read assessed; unsigned hematology does not",
  po["Beckman Coulter AU5800"]?.assessed === true && po["Siemens CLINITEK Status+"]?.assessed === true && po["Sysmex XN-1000"]?.assessed === false,
  JSON.stringify(Object.fromEntries(Object.entries(po).map(([k, o]) => [k, o.assessed]))));
const idx = (await call("GET", `${L}/competency/by-instrument`, undefined, T)).body.instruments || [];
const ix = Object.fromEntries(idx.map((x) => [x.instrumentName, x]));
check("6b. By instrument: AU5800 1 of 1 signed; XN-1000 0 of 2 signed with 1 ready to sign",
  ix["Beckman Coulter AU5800"]?.signed === 1 && ix["Sysmex XN-1000"]?.people === 2 && ix["Sysmex XN-1000"]?.signed === 0 && ix["Sysmex XN-1000"]?.ready === 1, JSON.stringify(ix["Sysmex XN-1000"]));

// ---------- 7. record PDF ----------
const tok = (await call("GET", `${L}/competency/employee/${pat}/record-pdf`, undefined, T)).body.token;
const pdfRes = await fetch(`${BASE}/api/pdf/${tok}`, { headers: { Authorization: `Bearer ${T}` } });
const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
let pages = 0; try { pages = (await PDFDocument.load(pdfBuf)).getPageCount(); } catch {}
// Every VeritaAssure PDF ends with the Copyright and License Terms page (licenseStamp.ts, page-break-before), so a
// one-page record is two pages in total.
check("7. the record PDF downloads as one record page plus the license page, so every method's sign-off line is on page 1", pdfRes.status === 200 && pages === 2, `${pdfRes.status} ${pdfBuf.length} bytes, ${pages} page(s)`);
if (OUT) fs.writeFileSync(`${OUT}/pat_record.pdf`, pdfBuf);
if (OUT) fs.writeFileSync(`${OUT}/pat_view.json`, JSON.stringify(await view(pat)));

// ---------- 8. browser ----------
const browser = await chromium.launch();
let first = true;
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, labId]);
  const tag = `[${scheme} ${width}px]`;
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${pat}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  const statuses = await page.getByTestId("method-status").allInnerTexts();
  check(`8a. ${tag} person page: each method carries its own status`, statuses.length === 4 && statuses.some((s) => /Initial signed/.test(s)) && statuses.some((s) => /ready to sign/i.test(s)), statuses.join(" | "));
  // First pass signs the XN-1000 from this page; later passes look at the still-unsigned manual differential.
  if (first) {
    await page.getByTestId("test-system-tab").filter({ hasText: "Sysmex XN-1000" }).click(); await page.waitForTimeout(400);
    const opts = await page.getByTestId("signer-select").locator("option").evaluateAll((os) => os.map((o) => ({ t: o.textContent, d: o.disabled })));
    const selected = await page.getByTestId("signer-select").inputValue();
    check(`8b. ${tag} XN-1000 (moderate) sign form: Taylor Brooks (hematology TS) preselected; Jordan greyed out with "not Hematology"`,
      opts[0]?.t?.startsWith("Taylor Brooks, Technical Supervisor") && !opts[0]?.d && opts.some((o) => o.d && /Jordan Rivera.*not Hematology/.test(o.t)) && selected !== "", JSON.stringify(opts));
  } else {
    await page.getByTestId("test-system-tab").filter({ hasText: "Manual Differential" }).click(); await page.waitForTimeout(400);
    const opts = await page.getByTestId("signer-select").locator("option").evaluateAll((os) => os.map((o) => ({ t: o.textContent, d: o.disabled })));
    check(`8b. ${tag} manual diff (high) sign form: Taylor Brooks (TS) first, Sam (delegated GS) eligible, Jordan (TC) greyed out`,
      opts[0]?.t?.startsWith("Taylor Brooks, Technical Supervisor") && opts.some((o) => !o.d && /Sam Ortiz, General Supervisor/.test(o.t)) && opts.some((o) => o.d && /Jordan Rivera/.test(o.t)), JSON.stringify(opts));
  }
  check(`${tag} person page: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: `${OUT}/pms_person_form_${scheme}_${width}.png`, fullPage: true });
  if (first) {
    first = false;
    await page.getByTestId("sign-method").click(); await page.waitForTimeout(1200);
    const banner = await page.getByTestId("method-signed").innerText().catch(() => "");
    const due = await page.getByTestId("method-next-due").innerText().catch(() => "");
    check(`8c. ${tag} clicking Sign: banner reads "Initial signed ... by Taylor Brooks, Technical Supervisor" with the 6-month due`,
      /Initial signed .* by Taylor Brooks, Technical Supervisor/.test(banner) && /6-month due/.test(due), `${banner.replace(/\s+/g, " ")} / ${due}`);
    await page.screenshot({ path: `${OUT}/pms_person_signed_${scheme}_${width}.png`, fullPage: true });
    const after = await view(pat);
    check(`8d. ${tag} the browser sign is stored: XN-1000 signed, the manual diff still open`, !!tsOf(after, XN).lastSignoff && !tsOf(after, DIFF).lastSignoff);
    // Instrument page: sign Kim on the XN-1000.
    await put(kim, XN, { elements: els("K") });
    await page.goto(`${BASE}/labs/${labId}/veritacomp-app/instrument/${XN}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    await page.getByTestId("person-tab").filter({ hasText: "Kim Bravo" }).click(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/pms_instrument_form_${scheme}_${width}.png`, fullPage: true });
    await page.getByTestId("sign-method").click(); await page.waitForTimeout(1200);
    const kimAfter = await view(kim);
    const summary = await page.getByTestId("instrument-summary").innerText();
    check(`8e. ${tag} instrument page: signing Kim stores her XN-1000 sign-off; summary reads 2 of 2 signed`,
      tsOf(kimAfter, XN).lastSignoff?.signerName === "Taylor Brooks" && /2 of 2 assigned people signed/.test(summary), summary);
    await page.screenshot({ path: `${OUT}/pms_instrument_signed_${scheme}_${width}.png`, fullPage: true });
    check(`${tag} instrument page: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `${failures} FAIL` : "ALL PASS");
process.exit(failures ? 1 : 0);
