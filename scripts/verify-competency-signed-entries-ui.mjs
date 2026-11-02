// scripts/verify-competency-signed-entries-ui.mjs
//
// Receipt for Michael 2026-11-02 (Q115 = 1): "Once it is signed, the supporting documentation is no longer visible. Is
// there another way to get to it? or an easy way to see 'completed' competencies to see supporting documentation".
// LOCAL production build + scratch DB only; every lab, person, instrument and entry below is a made-up fixture.
//   A. API: a signed method's sign-off carries the entries it was signed on (specimen IDs, observers named, dates,
//      both Element 5 samples, N/A reasons, documentation), for the latest and an earlier sign-off, and for a waived
//      method (evidence, date, initials); the working form for the next competency stays empty
//   B. API: GET /competency/signoffs lists every signed competency in the lab, newest first, with ids that open them
//   C. observer name match: a typed name that names an LD/TC/TS ("Tate, Casey") is accepted and shown as that person;
//      an unknown name is still refused (400) and a saved one still reads "saved earlier"
//   D. browser (light 1400, dark 1400, light 390): "View signed entries" and an earlier sign-off open read-only
//      entries; the Signed competencies list filters and each row opens the person page with that sign-off's entries
//      showing; the By-instrument page shows the signed facts; the VeritaComp landing links the list; no horizontal
//      page scroll
//   E. the record PDF downloads with the signed entries after page 1 (text checked by
//      scripts/verify-competency-record-pdf-entries.py)
// Run: PW_BASE=http://localhost:5197 SCRATCH_DB=<db> OUT=<dir> node scripts/verify-competency-signed-entries-ui.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const Database = require("better-sqlite3");
const { PDFDocument } = require("pdf-lib");
const BASE = process.env.PW_BASE, ADMIN = "test-admin-secret", OUT = process.env.OUT || ".";
let failures = 0;
const check = (name, cond, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const call = async (method, path, body, token) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mdy = (iso) => { const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`; };
const earlier = addDays(today, -30);

// ---------- fixture ----------
const email = `signed-entries-${Date.now()}@example.com`;
const owner = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Signed Entries Owner", hipaa_acknowledged: true })).body;
const T = owner.token;
const labId = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Signed Entries Lab", plan: "hospital" })).body.labId;
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE users SET has_completed_onboarding = 1, onboarding_seen = 1, plan = 'hospital' WHERE email = ?").run(email); db.prepare("UPDATE labs SET has_completed_onboarding = 1 WHERE id = ?").run(labId); db.close(); }
const L = `/api/labs/${labId}`;
await call("POST", `${L}/staff/lab`, { labName: "Signed Entries Lab", cliaNumber: "11D7654322", accreditationBody: "CLIA_ONLY", complexity: "high" }, T);
const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, T)).body.id;
const t = (analyte, specialty, complexity) => ({ analyte, specialty, complexity, active: 1 });
await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
  { name: "Beckman Coulter AU5800", category: "Chemistry", tests: [t("Sodium", "General Chemistry", "MODERATE")] },
  { name: "Siemens CLINITEK Status+", category: "Urinalysis", tests: [t("Urine Glucose", "Urinalysis", "WAIVED")] },
] });
const inst = Object.fromEntries((new Database(process.env.SCRATCH_DB, { readonly: true }).prepare("SELECT id, instrument_name FROM veritamap_instruments WHERE map_id = ?").all(mapId)).map((r) => [r.instrument_name, r.id]));
const CHEM = inst["Beckman Coulter AU5800"], UA = inst["Siemens CLINITEK Status+"];
const emp = async (firstName, lastName, extra = {}) => (await call("POST", `${L}/staff/employees`, { firstName, lastName, title: "MLS", performsTesting: true, highestComplexity: "H", hireDate: "2026-06-01", ...extra }, T)).body.id;
const pat = await emp("Pat", "Alpha"), kim = await emp("Kim", "Bravo");
const casey = await emp("Casey", "Tate", { roles: [{ role: "TC", specialtyNumber: 7 }] });
const morgan = await emp("Morgan", "Chen", { roles: [{ role: "LD" }] });
await call("PUT", `${L}/staff/employees/${pat}/instruments`, { instrumentIds: [CHEM, UA] }, T);
await call("PUT", `${L}/staff/employees/${kim}/instruments`, { instrumentIds: [CHEM] }, T);
check("0. fixture: chemistry (moderate) + urinalysis (waived), 2 testers, a TC and an LD", [CHEM, UA, pat, kim, casey, morgan].every(Boolean));

const put = (e, i, body) => call("PUT", `${L}/competency/employee/${e}/test-system/${i}`, body, T);
const view = async (e) => (await call("GET", `${L}/competency/employee/${e}`, undefined, T)).body;
const tsOf = (v, i) => (v.testSystems || []).find((x) => x.instrumentId === i) || {};
const sign = (e, i, body) => call("POST", `${L}/competency/employee/${e}/test-system/${i}/sign`, body, T);
const elOf = (s, n) => (s?.elements || []).find((e) => e.num === n) || {};

// Initial, signed 30 days ago from the paper record; then the 6-month today, with Element 3 N/A.
const initEls = [
  { num: 1, specimenId: "S-INIT", observerInitials: "CT", passed: true },
  { num: 2, evidence: "Critical potassium called to the ED", date: earlier, passed: true },
  { num: 3, qcDate: earlier, passed: true },
  { num: 4, dateObserved: earlier, observerInitials: "MC", passed: true },
  { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1", acceptable: true }, { sampleType: "PT", sampleId: "PT-2", acceptable: true }], passed: true },
  { num: 6, quizId: "Q-CHEM", score: 95, dateTaken: earlier, passed: true },
];
let r = await put(pat, CHEM, { elements: initEls });
check("A0. initial entries saved", r.status === 200, `${r.status} ${r.body.error || ""}`);
r = await sign(pat, CHEM, { signerStaffEmployeeId: casey, signerInitials: "CT", signedDate: earlier, documentation: "Paper record in the competency binder" });
check("A0. Casey (TC) signs the initial, dated 30 days ago with documentation", r.status === 200 && r.body.milestone === "initial", `${r.status} ${JSON.stringify(r.body)}`);
const initId = r.body.signoffId;
r = await put(pat, CHEM, { elements: [
  { num: 1, specimenId: "S-6MO", observerInitials: "CT", passed: true },
  { num: 2, evidence: "Delta check reviewed", date: today, passed: true },
  { num: 3, na: true, naJustification: "QC reviewed under element 2 for this cycle" },
  { num: 4, dateObserved: today, observerInitials: "CT", passed: true },
  { num: 5, samples: [{ sampleType: "Blind", sampleId: "BL-6", acceptable: true }], passed: true },
  { num: 6, quizId: "Q-CHEM-2", score: 100, dateTaken: today, passed: true },
] });
r = await sign(pat, CHEM, { signerIsMedicalDirector: false, signerStaffEmployeeId: morgan, signerInitials: "MC" });
check("A0. Morgan (LD) signs the 6-month today", r.status === 200 && r.body.milestone === "six_month", `${r.status} ${JSON.stringify(r.body)}`);
const sixId = r.body.signoffId;
await put(pat, UA, { waivedMethods: [{ num: 1, evidence: "Blind BS-1 read correctly", date: today, initials: "CT", passed: true }, { num: 4, evidence: "Written test 10/10", date: today, initials: "CT", passed: true }] });
r = await sign(pat, UA, { signerStaffEmployeeId: casey, signerInitials: "CT" });
check("A0. Casey signs the waived urinalysis initial", r.status === 200, `${r.status} ${JSON.stringify(r.body)}`);
const uaId = r.body.signoffId;

// ---------- A. entries on the sign-offs ----------
let v = await view(pat);
const chem = tsOf(v, CHEM), ua = tsOf(v, UA);
const six = chem.signoffs?.[0], init = chem.signoffs?.[1];
check("A1. chemistry has two sign-offs, newest first (6-month, then initial)", six?.id === sixId && init?.id === initId, `${six?.id}/${init?.id}`);
check("A2. the 6-month carries its entries: specimen S-6MO, observer CT named Tate, Casey",
  six?.hasEntries === true && elOf(six, 1).specimenId === "S-6MO" && elOf(six, 1).observerInitials === "CT" && elOf(six, 1).observerName === "Tate, Casey", JSON.stringify(elOf(six, 1)));
check("A3. the 6-month's Element 3 is N/A with its reason", elOf(six, 3).na === true && elOf(six, 3).naJustification === "QC reviewed under element 2 for this cycle" && elOf(six, 3).status === "na", JSON.stringify(elOf(six, 3)));
check("A4. the earlier initial keeps its own entries: S-INIT, evidence, QC date, observer MC named Chen, Morgan",
  elOf(init, 1).specimenId === "S-INIT" && elOf(init, 2).evidence === "Critical potassium called to the ED" && elOf(init, 3).qcDate === earlier && elOf(init, 4).observerName === "Chen, Morgan", JSON.stringify([elOf(init, 1), elOf(init, 4)]));
check("A5. the initial's Element 5 keeps both samples (PT-1, PT-2)", (elOf(init, 5).samples || []).map((s) => s.sampleId).join(",") === "PT-1,PT-2", JSON.stringify(elOf(init, 5).samples));
check("A6. the initial keeps its date and documentation", init?.signedDate === earlier && init?.documentation === "Paper record in the competency binder", `${init?.signedDate} ${init?.documentation}`);
const wm = ua.lastSignoff?.waivedMethods || [];
check("A7. the waived sign-off carries each method's evidence, date and initials",
  ua.lastSignoff?.id === uaId && ua.lastSignoff?.hasEntries === true && wm.some((m) => m.num === 1 && m.evidence === "Blind BS-1 read correctly" && m.initials === "CT" && m.date === today && m.status === "pass"), JSON.stringify(wm));
check("A8. the working form for the next competency is still empty", chem.hasData === false && (chem.elements || []).every((e) => !e.specimenId && !e.evidence), `hasData=${chem.hasData}`);

// ---------- B. signed list ----------
r = await call("GET", `${L}/competency/signoffs`, undefined, T);
const list = r.body.signoffs || [];
check("B1. GET /competency/signoffs: 200 with Pat's three sign-offs and nothing for Kim", r.status === 200 && list.length === 3 && list.every((x) => x.employeeId === pat), `${r.status} ${list.length}`);
check("B2. newest first: today's two, then the initial 30 days ago", list[0]?.signedDate === today && list[1]?.signedDate === today && list[2]?.signedDate === earlier && list[2]?.signoffId === initId, list.map((x) => `${x.signedDate}:${x.signoffId}`).join(" "));
const rowInit = list.find((x) => x.signoffId === initId) || {};
check("B3. a row names the person, method, department, competency, signer and result, and has entries",
  rowInit.employeeName === "Pat Alpha" && rowInit.methodName === "Beckman Coulter AU5800" && rowInit.department === "Chemistry" && rowInit.milestone === "initial" && rowInit.signerName === "Casey Tate" && rowInit.signerRole === "TC" && rowInit.determination === "pass" && rowInit.hasEntries === true && rowInit.instrumentId === CHEM, JSON.stringify(rowInit));

// ---------- C. observer name match ----------
const kimEls = (el1, el4) => [
  { num: 1, specimenId: "S-K", observerInitials: el1, passed: true },
  { num: 2, evidence: "Called", date: today, passed: true },
  { num: 3, qcDate: today, passed: true },
  { num: 4, dateObserved: today, observerInitials: el4, passed: true },
];
r = await put(kim, CHEM, { elements: kimEls("Tate, Casey", "CT") });
check("C1. a typed name that names the lab's TC (\"Tate, Casey\") is accepted", r.status === 200, `${r.status} ${r.body.error || ""}`);
r = await put(kim, CHEM, { elements: kimEls("Tate, Casey", "Lee Unknown") });
check("C2. an unknown name (\"Lee Unknown\") is still refused", r.status === 400 && /Lee Unknown/.test(r.body.error || ""), `${r.status} ${r.body.error}`);
{ const db = new Database(process.env.SCRATCH_DB); db.prepare("UPDATE competency_assessment_items SET el4_observer_initials = 'Pat Nobody' WHERE instrument_id = ? AND element_number = 4 AND signoff_id IS NULL").run(CHEM); db.close(); }

// ---------- E. record PDF ----------
// The signed entries print after page 1 (the sign-off lines stay on page 1). Text and layout are read from the saved
// file by scripts/verify-competency-record-pdf-entries.py.
const tok = (await call("GET", `${L}/competency/employee/${pat}/record-pdf`, undefined, T)).body.token;
const pdfRes = await fetch(`${BASE}/api/pdf/${tok}`, { headers: { Authorization: `Bearer ${T}` } });
const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
fs.writeFileSync(`${OUT}/record.pdf`, pdfBuf);
let pages = 0; try { pages = (await PDFDocument.load(pdfBuf)).getPageCount(); } catch {}
check("E1. the record PDF downloads: record page, signed-entries page, license page", pdfRes.status === 200 && pages >= 3, `${pdfRes.status} ${pages} pages`);

// ---------- D. browser ----------
const browser = await chromium.launch();
let firstPass = true;
for (const [scheme, width] of [["light", 1400], ["dark", 1400], ["light", 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  const me = await page.evaluate(async ([b, tk]) => (await fetch(`${b}/api/auth/me`, { headers: { Authorization: `Bearer ${tk}` } })).json(), [BASE, T]);
  await page.evaluate(([tk, u, l]) => { localStorage.setItem("veritas_token", tk); localStorage.setItem("veritas_user", JSON.stringify(u.user || u)); localStorage.setItem("veritas_active_lab_id", String(l)); }, [T, me, labId]);
  const tag = `[${scheme} ${width}px]`;
  const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  // D1. Person page: the latest sign-off's entries.
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${pat}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  await page.getByTestId("test-system-tab").filter({ hasText: "Beckman Coulter AU5800" }).click(); await page.waitForTimeout(300);
  await page.getByTestId("method-view-entries").click(); await page.waitForTimeout(300);
  const sixBox = page.getByTestId(`signed-entries-${sixId}`);
  const sixText = (await sixBox.innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`D1. ${tag} View signed entries shows the 6-month as signed (S-6MO, CT (Tate, Casey), the N/A reason, BL-6)`,
    /S-6MO/.test(sixText) && /CT \(Tate, Casey\)/.test(sixText) && /QC reviewed under element 2/.test(sixText) && /BL-6/.test(sixText), sixText.slice(0, 220));
  check(`D1. ${tag} the entries are read-only (no inputs inside)`, (await sixBox.locator("input, select, textarea").count()) === 0);
  check(`D1. ${tag} no horizontal page scroll with the entries open`, await noScroll());
  await sixBox.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/signed_entries_latest_${scheme}_${width}.png`, fullPage: true });

  // D2. An earlier sign-off opens its own entries.
  await page.getByTestId("method-earlier-view").first().click(); await page.waitForTimeout(300);
  const initText = (await page.getByTestId(`signed-entries-${initId}`).innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`D2. ${tag} the earlier initial shows its entries (S-INIT, both samples, the QC date, the documentation)`,
    /S-INIT/.test(initText) && /PT-1/.test(initText) && /PT-2/.test(initText) && initText.includes(mdy(earlier)) && /Paper record in the competency binder/.test(initText), initText.slice(0, 240));
  const title = await page.getByTestId("signed-entries-title").innerText().catch(() => "");
  check(`D2. ${tag} the open set is titled with its competency, date, signer and result`, title.includes(`Initial signed ${mdy(earlier)} by Casey Tate, Technical Consultant: Pass`), title);

  // D3. The waived method's entries.
  await page.getByTestId("test-system-tab").filter({ hasText: "CLINITEK" }).click(); await page.waitForTimeout(300);
  await page.getByTestId("method-view-entries").click(); await page.waitForTimeout(300);
  const uaText = (await page.getByTestId(`signed-entries-${uaId}`).innerText().catch(() => "")).replace(/\s+/g, " ");
  check(`D3. ${tag} the waived sign-off shows each method's evidence and initials`, /Blind BS-1 read correctly/.test(uaText) && /Written test 10\/10/.test(uaText) && /CT/.test(uaText), uaText.slice(0, 200));

  // D4. Signed competencies list: filter, then open a row.
  await page.goto(`${BASE}/labs/${labId}/veritacomp-app/signed`, { waitUntil: "networkidle" }); await page.waitForTimeout(700);
  check(`D4. ${tag} the list shows the three signed competencies`, (await page.getByTestId("signed-row").count()) === 3, String(await page.getByTestId("signed-row").count()));
  check(`D4. ${tag} list: no horizontal page scroll`, await noScroll());
  await page.screenshot({ path: `${OUT}/signed_list_${scheme}_${width}.png`, fullPage: true });
  await page.getByTestId("signed-search").fill("CLINITEK"); await page.waitForTimeout(200);
  const nSearch = await page.getByTestId("signed-row").count();
  await page.getByTestId("signed-search").fill("");
  await page.getByTestId("signed-milestone").selectOption("initial"); await page.waitForTimeout(200);
  const nInitial = await page.getByTestId("signed-row").count();
  await page.getByTestId("signed-from").fill(today); await page.waitForTimeout(200);
  const nInitialToday = await page.getByTestId("signed-row").count();
  check(`D4. ${tag} filters: search CLINITEK = 1, Initial = 2, Initial signed from today = 1`, nSearch === 1 && nInitial === 2 && nInitialToday === 1, `${nSearch}/${nInitial}/${nInitialToday}`);
  await page.getByTestId("signed-from").fill(""); await page.waitForTimeout(200);
  await page.getByTestId("signed-row").filter({ hasText: "Beckman" }).first().click();
  await page.waitForURL(/signoff=/, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(900);
  const arrived = page.getByTestId(`signed-entries-${initId}`);
  check(`D5. ${tag} a row opens the person page on that method with that sign-off's entries showing`,
    page.url().includes(`method=${CHEM}`) && page.url().includes(`signoff=${initId}`) && (await arrived.count()) === 1 && /S-INIT/.test(await arrived.innerText().catch(() => "")), page.url());
  await arrived.scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: `${OUT}/signed_list_opened_${scheme}_${width}.png`, fullPage: true });

  if (firstPass) {
    // D6. By-instrument page shows the signed set's facts.
    await page.goto(`${BASE}/labs/${labId}/veritacomp-app/instrument/${CHEM}`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
    await page.getByTestId("person-tab").filter({ hasText: "Pat Alpha" }).click(); await page.waitForTimeout(300);
    const rows = (await page.getByTestId("element-row").allInnerTexts()).join(" | ");
    check(`D6. ${tag} By instrument: Pat's signed set shows its facts (Specimen: S-6MO)`, /Specimen: S-6MO/.test(rows), rows.slice(0, 160));
    // D7. The VeritaComp landing links the list.
    await page.goto(`${BASE}/labs/${labId}/veritacomp-app`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    await page.getByTestId("roster-signed-link").first().click();
    await page.waitForURL(/veritacomp-app\/signed/, { timeout: 10000 }).catch(() => {});
    check(`D7. ${tag} the VeritaComp landing links to Signed competencies`, /veritacomp-app\/signed$/.test(page.url()), page.url());
    // C3. Kim's page: the typed name reads as Casey; the unknown saved name keeps its note.
    await page.goto(`${BASE}/labs/${labId}/veritacomp-app/employee/${kim}`, { waitUntil: "networkidle" }); await page.waitForTimeout(900);
    const el1 = (await page.getByTestId("element-1-observerInitials").innerText().catch(() => "")).replace(/\s+/g, " ");
    const el1Note = await page.getByTestId("element-1-observerInitials-saved-note").count();
    const el4Note = await page.getByTestId("element-4-observerInitials-saved-note").count();
    check(`C3. ${tag} "Tate, Casey" shows as Casey Tate (TC) with no warning; "Pat Nobody" keeps the saved-earlier note`, /Tate, Casey \(TC\)/.test(el1) && el1Note === 0 && el4Note === 1, `${el1} / notes ${el1Note},${el4Note}`);
    await page.getByTestId("element-1-observerInitials").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/observer_name_match_${scheme}_${width}.png`, fullPage: false });
    firstPass = false;
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
process.exit(failures ? 1 : 0);
