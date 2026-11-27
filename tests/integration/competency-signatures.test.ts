// tests/integration/competency-signatures.test.ts
//
// B5 (signatures mock 2, 2026-11-27; shared/competencyObservation.ts, server/competencySignatures.ts): competency signed by the
// person who watched and the person who evaluated, each as themselves (server/eSignature.ts verifySigner). Boots the REAL routes on
// a scratch DB with made-up people and proves:
//   1. an entry made now names its observer and waits for them; the observer's list holds only the entries naming them
//   2. an electronic Pass is refused until the observer signs (Q2 = 1), Fail and Remediation Required are not, and entries made
//      before this went live stay as recorded and can be a Pass
//   3. the observer signs several observations under one signature, each its own row and audit row; only the named observer, and
//      nobody signs their own; a wrong password, a GS, another lab and Veritas support are refused; a change after signing undoes it
//   4. the evaluator signs as themselves (the list-picked body of before is refused), from a Staff login too, which can't edit
//      (Q3 = 1); the server makes the record's fingerprint from the frozen entries
//   5. a sign-off from paper is kept with where the paper is and who recorded it (Q1 = 1), and needs edit
//   6. a hospital sign-in user signs both through S0, and a password can't
//   7. unlock asks a reason; 8. the printed record (page 1 and the signed entries); 9. the staff own-data limit still holds
// Run: npm run test:competency-signatures
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { buildEmployeeCompetencyRecordHTML } = await import("../../server/pdfReport");
  const { createSignRequest, issueSignHandoff } = await import("../../server/eSignature");
  const { recordFingerprint } = await import("../../server/competencySignatures");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const PW = ["Made", "up", "Pass", "7!"].join("-");
  const WRONG = ["Not", "the", "one", "9?"].join("-");
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  const day = daysAgo(10), observed = daysAgo(3);
  const call = async (method: string, path: string, body: unknown, token: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const register = async (tag: string, domain = "example.com") => {
    const email = `b5-${tag.toLowerCase()}-${stamp}@${domain}`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW, name: `B5 ${tag}`, hipaa_acknowledged: true }) })).json();
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);

  try {
    const OWNER = await register("Owner"), OWNER2 = await register("Owner2");
    const CASEY = await register("Casey"), MORGAN = await register("Morgan"), RILEY = await register("Riley"), SAM = await register("Sam"), SUPPORT = await register("Support");
    const HANA = await register("Hana", "hospital-b5.test");
    const labId = await provision(OWNER.email, "Example Signature Lab");
    const lab2 = await provision(OWNER2.email, "Example Other Lab");
    const L = `/api/labs/${labId}`, L2 = `/api/labs/${lab2}`;
    await call("POST", `${L}/staff/lab`, { labName: "Example Signature Lab", cliaNumber: "11D7654391", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    await call("POST", `${L2}/staff/lab`, { labName: "Example Other Lab", cliaNumber: "11D7654392", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER2.token);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, OWNER.token)).j.id;
    const map2 = (await call("POST", `${L2}/veritamap/maps`, { name: "Core" }, OWNER2.token)).j.id;
    const t = (analyte: string) => ({ analyte, specialty: "Chemistry", complexity: "MODERATE", active: 1 });
    const names = ["CH-500 Made-up", "CH-501 Made-up", "CH-502 Made-up", "CH-503 Made-up", "CH-504 Made-up", "CH-505 Made-up"];
    await fetch(`${base}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId, defaultActive: 1, instruments: names.map((name, i) => ({ name, category: "Chemistry", tests: [t(`Made-up A${i}`)] })) }) });
    await fetch(`${base}/api/admin/veritamap/seed-map?secret=${ADMIN}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mapId: map2, defaultActive: 1, instruments: [{ name: "CH-900 Other", category: "Chemistry", tests: [t("Made-up Z")] }] }) });
    const instOf = (name: string) => Number((sqlite.prepare("SELECT i.id FROM veritamap_instruments i JOIN veritamap_maps m ON m.id = i.map_id WHERE i.instrument_name = ? AND m.lab_id IN (?, ?)").get(name, labId, lab2) as any)?.id);
    const [CHEM, CHEM2, OLD, PAPER, HOSP, BEFORE] = names.map(instOf);
    const OTHER = instOf("CH-900 Other");
    const assign = (emp: number, list: number[]) => list.forEach((i) => sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(emp, i, now));
    const person = async (labPath: string, token: string, last: string, first: string, roles: any[] = []) =>
      Number((await call("POST", `${labPath}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "H", performsTesting: true, hireDate: "2019-03-01", roles }, token)).j.id);
    const sam = await person(L, OWNER.token, "Rivera", "Sam");
    const casey = await person(L, OWNER.token, "Tate", "Casey", [{ role: "TC", specialtyNumber: 7 }]);
    const morgan = await person(L, OWNER.token, "Chen", "Morgan", [{ role: "TS", specialtyNumber: 7 }]);
    const riley = await person(L, OWNER.token, "Park", "Riley", [{ role: "GS" }]);
    const hana = await person(L, OWNER.token, "Ito", "Hana", [{ role: "TC", specialtyNumber: 7 }]);
    const lee = await person(L2, OWNER2.token, "Ward", "Lee", [{ role: "TC", specialtyNumber: 7 }]);
    const zed = await person(L2, OWNER2.token, "Lab", "Zed");
    assign(sam, [CHEM, CHEM2, OLD, PAPER, HOSP, BEFORE]);
    assign(casey, [CHEM]);
    assign(zed, [OTHER]);
    const member = (lab: number, userId: number) => sqlite.prepare(
      `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)`
    ).run(lab, userId, now, now, now);
    const seat = (u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    ).run(OWNER.id, u.email, u.id, now, now, perms, `b5-${u.id}-${type}-${stamp}`, labId, type, rosterId);
    // Staff logins (read and sign) for Casey, Riley and Sam; editors linked to their roster rows for Morgan and Hana.
    for (const [u, r] of [[CASEY, casey], [RILEY, riley], [SAM, sam]] as const) { member(labId, u.id); seat(u, "staff_portal", '{"mode":"view_all"}', r); }
    for (const [u, r] of [[MORGAN, morgan], [HANA, hana]] as const) {
      member(labId, u.id); seat(u, "active", '{"mode":"edit_all"}', null);
      sqlite.prepare("UPDATE staff_employees SET login_user_id = ? WHERE id = ?").run(u.id, r);
    }
    await (await fetch(base + "/api/admin/vls-support/user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, email: SUPPORT.email, enabled: true }) })).json();
    check("0. fixture: two labs, six methods, the people and their logins", labId > 0 && lab2 > 0 && [CHEM, CHEM2, OLD, PAPER, HOSP, BEFORE, OTHER].every((x) => x > 0) && [sam, casey, morgan, riley, hana, lee, zed].every((x) => x > 0));

    const entries = (obs: string, el1Date = "") => [
      { num: 1, specimenId: "QA-1042", observerInitials: obs, dateObserved: el1Date, passed: true },
      { num: 2, evidence: "Result review", date: day, passed: true },
      { num: 3, qcDate: day, passed: true },
      { num: 4, dateObserved: el1Date || day, observerInitials: obs, passed: true },
      { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1", acceptable: true }], passed: true },
      { num: 6, quizId: "Q-1", score: 100, dateTaken: day, passed: true },
    ];
    const put = (emp: number, inst: number, body: any, token = OWNER.token, path = L) => call("PUT", `${path}/competency/employee/${emp}/test-system/${inst}`, body, token);
    const view = async (emp: number, token = OWNER.token) => (await call("GET", `${L}/competency/employee/${emp}`, undefined, token)).j;
    const tsOf = (v: any, id: number) => (v?.testSystems || []).find((x: any) => x.instrumentId === id) || {};
    const el = (ts: any, n: number) => (ts.elements || []).find((e: any) => e.num === n) || {};
    const toSign = async (token: string) => (await call("GET", `${L}/competency/to-sign`, undefined, token)).j;
    const signObs = (token: string, items: any[], extra: any = {}) => call("POST", `${L}/competency/observations/sign`, { typedName: "Made Up Name", password: PW, items, ...extra }, token);
    const signMethod = (emp: number, inst: number, token: string, body: any) => call("POST", `${L}/competency/employee/${emp}/test-system/${inst}/sign`, body, token);
    const rows = (emp: number, inst: number) => sqlite.prepare(
      `SELECT i.* FROM competency_assessment_items i JOIN competency_assessments a ON a.id = i.assessment_id JOIN competency_employees ce ON ce.id = a.employee_id
        WHERE ce.staff_employee_id = ? AND i.instrument_id = ? ORDER BY i.id`).all(emp, inst) as any[];
    const rowEl = (emp: number, inst: number, n: number) => rows(emp, inst).find((r) => Number(r.element_number) === n && r.signoff_id == null) || {};
    const sigCount = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM competency_observation_signatures").get() as any).n);
    const signoffs = (emp: number, inst: number) => sqlite.prepare("SELECT * FROM competency_method_signoffs WHERE staff_employee_id = ? AND instrument_id = ? ORDER BY id").all(emp, inst) as any[];
    const audits = (type: string) => sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = ? ORDER BY id").all(type) as any[];
    const failed = (userId: number) => Number((sqlite.prepare("SELECT COALESCE(failed_login_count, 0) AS n FROM users WHERE id = ?").get(userId) as any).n);

    // ── 1. An entry made now names its observer and waits for them ──────────────
    const saved = await put(sam, CHEM, { elements: entries("CT") });
    let ts = tsOf(await view(sam), CHEM);
    check("1a. the evaluator's save works and the method is complete, every element marked Pass", saved.s === 200 && ts.signable === true && !ts.passBlockMessage, JSON.stringify(saved.j));
    check("1b. Elements 1 and 4 made now wait for the observer they name, Casey Tate", el(ts, 1).observer?.required === true && el(ts, 1).observer?.signed === null && el(ts, 1).observer?.observerName === "Casey Tate" && el(ts, 4).observer?.required === true, JSON.stringify(el(ts, 1).observer));
    check("1c. the method says who it waits for", ts.observersWaiting?.length === 2 && /Element 1 \(Casey Tate\) and Element 4 \(Casey Tate\)/.test(ts.observerPassBlock || ""), ts.observerPassBlock);
    const caseyList = await toSign(CASEY.token);
    const obsRows = (caseyList.observations || []).filter((o: any) => o.employeeId === sam && o.instrumentId === CHEM);
    check("1d. Casey's list (a Staff login) has the two observations naming Casey, the specimen watched and no one else's record", caseyList.me?.staffEmployeeId === casey && obsRows.length === 2 && obsRows.some((o: any) => o.element === 1 && o.watched === "QA-1042") && caseyList.canRecordPaper === false, JSON.stringify(caseyList).slice(0, 300));
    const morganList = await toSign(MORGAN.token);
    check("1e. Morgan's list has none of them: Morgan isn't the observer named", (morganList.observations || []).length === 0 && morganList.me?.staffEmployeeId === morgan, JSON.stringify(morganList.observations));
    const resave = await put(sam, CHEM, { elements: entries("CT") });
    check("1f. saving again keeps the entries as made after this went live", resave.s === 200 && Number(rowEl(sam, CHEM, 1).observer_sign_required) === 1);

    // ── 2. A Pass waits for the observer; Fail and Remediation don't; entries made before stay as they were ──
    const morganFails = failed(MORGAN.id);
    const early = await signMethod(sam, CHEM, MORGAN.token, { typedName: "Morgan Chen", password: PW, determination: "pass" });
    check("2a. an electronic Pass is refused until the observer signs, before any password is checked", early.s === 409 && early.j.code === "OBSERVER_NOT_SIGNED" && signoffs(sam, CHEM).length === 0 && failed(MORGAN.id) === morganFails, JSON.stringify(early.j));
    await put(sam, CHEM2, { elements: entries("CT") });
    const remed = await signMethod(sam, CHEM2, MORGAN.token, { typedName: "Morgan Chen", password: PW, determination: "remediation", remediationPlan: "Retrain and observe again" });
    const remedRow = signoffs(sam, CHEM2)[0];
    check("2b. Remediation Required is signed with the observer still waiting, by Morgan as themselves", remed.s === 200 && remedRow?.signer_staff_employee_id === morgan && remedRow?.determination === "remediation" && remedRow?.signed_with === "password", JSON.stringify(remed.j));
    await put(sam, OLD, { elements: entries("CT") });
    sqlite.prepare("UPDATE competency_assessment_items SET observer_sign_required = NULL WHERE instrument_id = ?").run(OLD); // as every row from before this went live
    await put(sam, OLD, { elements: entries("CT") });
    ts = tsOf(await view(sam), OLD);
    check("2c. entries made before stay as recorded: a re-save keeps them so, nothing waits", rowEl(sam, OLD, 1).observer_sign_required == null && el(ts, 1).observer?.required === false && !ts.observerPassBlock && (ts.observersWaiting || []).length === 0, JSON.stringify(el(ts, 1).observer));
    const oldPass = await signMethod(sam, OLD, MORGAN.token, { typedName: "Morgan Chen", password: PW, determination: "pass" });
    check("2d. and they can be signed as a Pass", oldPass.s === 200 && signoffs(sam, OLD)[0]?.determination === "pass", JSON.stringify(oldPass.j));

    // ── 3. The observer signs what they watched ──────────────────────────────────
    // The list as it is now: an evaluator's save writes the rows again, so an entry is signed as the list last showed it.
    const items = ((await toSign(CASEY.token)).observations || []).filter((o: any) => o.employeeId === sam && o.instrumentId === CHEM)
      .map((o: any) => ({ itemId: o.itemId, dateObserved: observed, result: "pass" }));
    const stale = await signObs(CASEY.token, [{ itemId: obsRows[0].itemId, dateObserved: observed, result: "pass" }], { typedName: "Casey Tate" });
    check("3. an entry the evaluator saved again since the list was read is refused, and says so", stale.j.results?.[0]?.code === "NOT_FOUND" && /changed since the list was opened/.test(stale.j.results?.[0]?.message || ""), JSON.stringify(stale.j));
    let before = sigCount();
    const notNamed = await signObs(MORGAN.token, items.slice(0, 1));
    check("3a. someone who isn't the named observer is refused, and told who is", notNamed.s === 200 && notNamed.j.results?.[0]?.ok === false && notNamed.j.results?.[0]?.message === "Not signed. Casey Tate is the observer named on this element." && sigCount() === before, JSON.stringify(notNamed.j));
    const caseyFails = failed(CASEY.id);
    const wrongPw = await signObs(CASEY.token, items, { password: WRONG });
    check("3b. a wrong password records nothing, says so, and counts toward the lockout", wrongPw.s === 401 && wrongPw.j.error === "Password incorrect; signature not recorded" && sigCount() === before && failed(CASEY.id) === caseyFails + 1, JSON.stringify(wrongPw.j));
    const gs = await signObs(RILEY.token, items);
    check("3c. a general supervisor isn't an observer", gs.s === 403 && gs.j.code === "NOT_AN_OBSERVER" && sigCount() === before, JSON.stringify(gs.j));
    const sup = await signObs(SUPPORT.token, items);
    check("3d. Veritas support can't sign", sup.s === 403 && /veritas/i.test(String(sup.j.error || "")) && sigCount() === before, JSON.stringify(sup.j));
    const otherLab = await call("POST", `${L2}/competency/observations/sign`, { typedName: "Casey Tate", password: PW, items }, CASEY.token);
    check("3e. another lab refuses Casey", otherLab.s === 403 && sigCount() === before, `${otherLab.s}`);
    await put(zed, OTHER, { elements: entries("LW") }, OWNER2.token, L2);
    const otherItem = rows(zed, OTHER).find((r) => Number(r.element_number) === 1)?.id;
    const auditsBefore = audits("competency_observation_signature").length;
    const both = await signObs(CASEY.token, [...items, { itemId: otherItem, dateObserved: observed, result: "pass" }], { typedName: "Casey Tate" });
    const sigs = sqlite.prepare("SELECT * FROM competency_observation_signatures WHERE staff_employee_id = ? AND instrument_id = ? ORDER BY id").all(sam, CHEM) as any[];
    check("3f. Casey, from a Staff login, signs both under one signature; another lab's entry is refused on its own", both.s === 200 && both.j.signed === 2 && both.j.refused === 1 && both.j.results?.[2]?.code === "NOT_FOUND", JSON.stringify(both.j));
    check("3g. each observation has its own signature row and audit row, as Casey, with the date observed and the result", sigs.length === 2 && sigs.every((s) => s.observer_staff_employee_id === casey && s.signed_by_user_id === CASEY.id && s.typed_name === "Casey Tate" && s.signed_with === "password" && s.date_observed === observed && s.result === "pass") && audits("competency_observation_signature").length === auditsBefore + 2);
    ts = tsOf(await view(sam), CHEM);
    check("3h. the record reads signed by the observer and sets Element 1's date observed", el(ts, 1).observer?.signed?.name === "Casey Tate" && el(ts, 4).observer?.signed?.role === "TC" && el(ts, 1).dateObserved === observed && (ts.observersWaiting || []).length === 0 && !ts.observerPassBlock, JSON.stringify(el(ts, 1)));
    const again = await signObs(CASEY.token, items.slice(0, 1), { typedName: "Casey Tate" });
    check("3i. a signed observation isn't signed twice, and leaves the list", again.j.results?.[0]?.code === "ALREADY_SIGNED" && !((await toSign(CASEY.token)).observations || []).some((o: any) => o.employeeId === sam && o.instrumentId === CHEM));
    // Nobody signs their own: Casey's own record names Casey as observer.
    await put(casey, CHEM, { elements: entries("CT") });
    const ownItem = rows(casey, CHEM).find((r) => Number(r.element_number) === 1)?.id;
    const own = await signObs(CASEY.token, [{ itemId: ownItem, dateObserved: observed, result: "pass" }], { typedName: "Casey Tate" });
    check("3j. nobody signs their own competency, and it isn't on their list", own.j.results?.[0]?.code === "OWN_COMPETENCY" && !((await toSign(CASEY.token)).observations || []).some((o: any) => o.employeeId === casey), JSON.stringify(own.j));
    // A Staff login keeps away from what the observer signed.
    const selfEdit = await call("PUT", `${L}/competency/employee/${sam}/test-system/${CHEM}/my-data`, { elements: [{ num: 1, specimenId: "QA-0000" }] }, SAM.token);
    check("3k. the person observed can't change a signed observation from their Staff login", selfEdit.s === 400 && /signed by your observer/.test(selfEdit.j.error || "") && rowEl(sam, CHEM, 1).el1_specimen_id === "QA-1042", JSON.stringify(selfEdit.j));
    // A change by the evaluator undoes the signature; putting it back as signed restores it.
    const changed = entries("CT", observed).map((e) => (e.num === 1 ? { ...e, specimenId: "QA-9999" } : e));
    await put(sam, CHEM, { elements: changed });
    ts = tsOf(await view(sam), CHEM);
    check("3l. a change after signing: the signature no longer holds, the observer signs again, the row stays on file", el(ts, 1).observer?.signed === null && el(ts, 1).observer?.changedAfterSigning === true && /Element 1/.test(ts.observerPassBlock || "") && sigCount() >= 2, JSON.stringify(el(ts, 1).observer));
    await put(sam, CHEM, { elements: entries("CT", observed) });
    ts = tsOf(await view(sam), CHEM);
    check("3m. the entry as it was signed holds the signature again", !!el(ts, 1).observer?.signed && !ts.observerPassBlock);

    // ── 4. The evaluator signs the method as themselves ─────────────────────────
    const listPick = await signMethod(sam, CHEM, OWNER.token, { signerStaffEmployeeId: casey, signerInitials: "CT", determination: "pass" });
    check("4a. a name picked from a list no longer signs", listPick.s === 400 && listPick.j.code === "SIGN_AS_YOURSELF" && signoffs(sam, CHEM).length === 0, JSON.stringify(listPick.j));
    const ownerSelf = await signMethod(sam, CHEM, OWNER.token, { typedName: "Owner", password: PW, determination: "pass" });
    check("4b. a sign-in not linked to a VeritaStaff person can't sign", ownerSelf.s === 403 && ownerSelf.j.code === "NOT_ON_ROSTER", JSON.stringify(ownerSelf.j));
    const rileyEval = await signMethod(sam, CHEM, RILEY.token, { typedName: "Riley Park", password: PW, determination: "pass" });
    check("4c. a general supervisor can't sign moderate complexity (today's rule)", rileyEval.s === 403 && rileyEval.j.code === "NOT_ELIGIBLE" && /moderate complexity needs a technical consultant or supervisor/.test(rileyEval.j.error || ""), JSON.stringify(rileyEval.j));
    await put(casey, CHEM, { elements: entries("MC") });
    const ownEval = await signMethod(casey, CHEM, CASEY.token, { typedName: "Casey Tate", password: PW, determination: "fail", remediationPlan: "x" });
    check("4d. nobody signs their own competency as evaluator", ownEval.s === 403 && /Cannot sign their own competency/.test(ownEval.j.error || ""), JSON.stringify(ownEval.j));
    const supEval = await signMethod(sam, CHEM, SUPPORT.token, { typedName: "Support", password: PW, determination: "pass" });
    check("4e. Veritas support can't sign a method", supEval.s === 403 && /veritas/i.test(String(supEval.j.error || "")), JSON.stringify(supEval.j));
    const caseyMethods = (await toSign(CASEY.token)).methods || [];
    const chemLine = caseyMethods.find((m: any) => m.employee.id === sam && m.testSystem.instrumentId === CHEM);
    check("4f. Casey's list has Sam's method to review, cut to Casey's own signer line and no history", !!chemLine && chemLine.testSystem.signers.length === 1 && chemLine.testSystem.signers[0].staffEmployeeId === casey && chemLine.testSystem.signoffs.length === 0 && !caseyMethods.some((m: any) => m.employee.id === casey), JSON.stringify(caseyMethods.map((m: any) => [m.employee.id, m.testSystem.instrumentId])));
    const editTry = await put(sam, CHEM, { elements: entries("CT", observed) }, CASEY.token);
    check("4g. a Staff login can't edit the entries", editTry.s === 403, `${editTry.s}`);
    const signed = await signMethod(sam, CHEM, CASEY.token, { typedName: "Casey Tate", password: PW, determination: "pass", milestone: "initial" });
    const row = signoffs(sam, CHEM)[0];
    const frozen = sqlite.prepare("SELECT * FROM competency_assessment_items WHERE signoff_id = ?").all(row?.id) as any[];
    check("4h. Casey signs the method as themselves from a Staff login: signer, typed name, how and when", signed.s === 200 && row?.signer_staff_employee_id === casey && row?.typed_name === "Casey Tate" && row?.signed_with === "password" && !!row?.signed_at && Number(row?.from_paper) === 0 && row?.signed_by_user_id === CASEY.id, JSON.stringify({ s: signed.s, j: signed.j, row }));
    check("4i. the server makes the record's fingerprint from the frozen entries", /^[0-9a-f]{64}$/.test(row?.record_fingerprint || "") && frozen.length === 6 && recordFingerprint(row, frozen) === row.record_fingerprint && signed.j.fingerprint === row.record_fingerprint);
    const audit = audits("employee_competency").filter((a) => /signed by Casey Tate/.test(a.entity_label || "")).pop();
    check("4j. the audit row says who signed and how", !!audit && audit.user_id === CASEY.id && /electronically \(name and password\)/.test(audit.entity_label) && JSON.parse(audit.after_json).record_fingerprint === row.record_fingerprint);
    ts = tsOf(await view(sam), CHEM);
    check("4k. the record shows how it was signed and that the fingerprint holds", ts.lastSignoff?.signedWith === "password" && ts.lastSignoff?.fingerprintHolds === true && ts.lastSignoff?.elements?.find((e: any) => e.num === 1)?.observer?.signed?.name === "Casey Tate");
    sqlite.prepare("UPDATE competency_assessment_items SET el2_evidence = 'Changed behind the record' WHERE signoff_id = ? AND element_number = 2").run(row.id);
    check("4l. a frozen entry changed outside the app no longer matches the fingerprint", tsOf(await view(sam), CHEM).lastSignoff?.fingerprintHolds === false);
    sqlite.prepare("UPDATE competency_assessment_items SET el2_evidence = 'Result review' WHERE signoff_id = ? AND element_number = 2").run(row.id);

    // ── 5. From paper ───────────────────────────────────────────────────────────
    await put(sam, PAPER, { elements: entries("CT") });
    const paperBody = { fromPaper: true, signerStaffEmployeeId: casey, signedDate: daysAgo(20), determination: "pass", milestone: "initial" };
    const staffPaper = await signMethod(sam, PAPER, CASEY.token, { ...paperBody, paperLocation: "Binder C-4" });
    check("5a. a Staff login can't enter a sign-off from paper (that edits the record)", staffPaper.s === 403 && staffPaper.j.code === "PAPER_NEEDS_EDIT", JSON.stringify(staffPaper.j));
    const noWhere = await signMethod(sam, PAPER, MORGAN.token, paperBody);
    check("5b. from paper needs where the paper is kept", noWhere.s === 400 && noWhere.j.code === "PAPER_LOCATION_REQUIRED", JSON.stringify(noWhere.j));
    const paper = await signMethod(sam, PAPER, MORGAN.token, { ...paperBody, paperLocation: "Binder C-4" });
    const pRow = signoffs(sam, PAPER)[0];
    check("5c. kept, marked From paper, with where and who recorded it; the paper carries the observer, so a Pass isn't held", paper.s === 200 && Number(pRow?.from_paper) === 1 && pRow?.paper_location === "Binder C-4" && pRow?.recorded_by_user_id === MORGAN.id && pRow?.signer_staff_employee_id === casey && pRow?.signed_with == null && pRow?.signed_date === daysAgo(20), JSON.stringify({ j: paper.j, pRow }));
    const pLast = tsOf(await view(sam), PAPER).lastSignoff;
    check("5d. the record names who recorded it", pLast?.fromPaper === true && pLast?.recordedByName === "B5 Morgan" && pLast?.paperLocation === "Binder C-4", JSON.stringify(pLast));

    // ── 6. A hospital sign-in user signs through S0 ──────────────────────────────
    await put(sam, HOSP, { elements: entries("HI") });
    sqlite.prepare("INSERT INTO sso_configs (name, issuer, client_id, email_domains, required, enabled) VALUES (?, ?, ?, ?, 1, 1)").run("Example Hospital", "https://idp.example.test/b5", "b5-client", JSON.stringify(["hospital-b5.test"]));
    const cfgId = Number((sqlite.prepare("SELECT id FROM sso_configs WHERE client_id = 'b5-client'").get() as any).id);
    const proof = async (purpose: string) => {
      const reqId = createSignRequest(sqlite, { userId: HANA.id, purpose: purpose as any, configId: cfgId, waiter: `waiter${stamp}${purpose.length}` });
      const code = issueSignHandoff(sqlite, reqId, { providerName: "Example Hospital", authTime: new Date().toISOString() });
      return String((await call("POST", "/api/auth/signature/sso/complete", { code }, HANA.token)).j.proof || "");
    };
    const hanaItems = ((await toSign(HANA.token)).observations || []).filter((o: any) => o.instrumentId === HOSP).map((o: any) => ({ itemId: o.itemId, dateObserved: observed, result: "pass" }));
    const hanaPw = await signObs(HANA.token, hanaItems, { typedName: "Hana Ito" });
    check("6a. where the hospital requires its sign-in, a password can't sign", hanaItems.length === 2 && hanaPw.s === 403 && hanaPw.j.code === "SSO_SIGN_REQUIRED", JSON.stringify(hanaPw.j));
    const wrongPurpose = await call("POST", `${L}/competency/observations/sign`, { typedName: "Hana Ito", ssoProof: await proof("competency_method"), items: hanaItems }, HANA.token);
    check("6b. a proof asked for to sign a method can't sign an observation", wrongPurpose.s === 401 && wrongPurpose.j.code === "SIGN_PROOF_INVALID", JSON.stringify(wrongPurpose.j));
    const hanaObs = await call("POST", `${L}/competency/observations/sign`, { typedName: "Hana Ito", ssoProof: await proof("competency_observation"), items: hanaItems }, HANA.token);
    const hSig = sqlite.prepare("SELECT * FROM competency_observation_signatures WHERE instrument_id = ? ORDER BY id").all(HOSP) as any[];
    check("6c. the observer signs with a fresh hospital sign-in, recorded as such", hanaObs.s === 200 && hanaObs.j.signed === 2 && hSig.length === 2 && hSig.every((s) => s.signed_with === "sso" && s.signed_with_provider === "Example Hospital"), JSON.stringify(hanaObs.j));
    const hanaMethod = await signMethod(sam, HOSP, HANA.token, { typedName: "Hana Ito", ssoProof: await proof("competency_method"), determination: "pass" });
    const hRow = signoffs(sam, HOSP)[0];
    check("6d. and signs the method the same way", hanaMethod.s === 200 && hRow?.signer_staff_employee_id === hana && hRow?.signed_with === "sso" && hRow?.signed_with_provider === "Example Hospital", JSON.stringify(hanaMethod.j));

    // ── 7. Unlock asks a reason ──────────────────────────────────────────────────
    const staffUnlock = await call("POST", `${L}/competency/employee/${sam}/test-system/${PAPER}/signoffs/${pRow.id}/revoke`, { reason: "x" }, CASEY.token);
    const noReason = await call("POST", `${L}/competency/employee/${sam}/test-system/${PAPER}/signoffs/${pRow.id}/revoke`, {}, OWNER.token);
    check("7a. a Staff login can't unlock; an editor must say why", staffUnlock.s === 403 && noReason.s === 400 && noReason.j.code === "UNLOCK_REASON_REQUIRED" && signoffs(sam, PAPER)[0].revoked_at == null, `${staffUnlock.s} ${JSON.stringify(noReason.j)}`);
    const unlocked = await call("POST", `${L}/competency/employee/${sam}/test-system/${PAPER}/signoffs/${pRow.id}/revoke`, { reason: "Wrong binder named" }, OWNER.token);
    const uRow = signoffs(sam, PAPER)[0];
    const uAudit = audits("employee_competency").filter((a) => /^Unlocked/.test(a.entity_label || "")).pop();
    check("7b. the reason is kept on the sign-off and its audit row", unlocked.s === 200 && !!uRow.revoked_at && uRow.revoke_reason === "Wrong binder named" && /Wrong binder named/.test(uAudit?.entity_label || "") && JSON.parse(uAudit?.after_json || "{}").revoke_reason === "Wrong binder named");
    await signMethod(sam, PAPER, MORGAN.token, { ...paperBody, paperLocation: "Binder C-4" });

    // ── 8. The printed record ───────────────────────────────────────────────────
    // A sign-off made before this build: no typed name, no how, no paper.
    await put(sam, BEFORE, { elements: entries("CT") });
    sqlite.prepare(`INSERT INTO competency_method_signoffs (lab_id, staff_employee_id, instrument_id, milestone, signed_date, signer_staff_employee_id, signer_name, signer_role, signer_initials, complexity, signed_by_user_id, created_at, determination)
      VALUES (?, ?, ?, 'initial', ?, ?, 'Casey Tate', 'TC', 'CT', 'MODERATE', ?, ?, 'pass')`).run(labId, sam, BEFORE, daysAgo(40), casey, OWNER.id, now);
    const v = await view(sam);
    const html = buildEmployeeCompetencyRecordHTML({ labName: "Example Signature Lab", cliaNumber: "11D7654391", employee: v.employee, elementCount: v.elementCount, testSystems: v.testSystems });
    const page1 = html.slice(html.indexOf("EVALUATOR SIGN-OFF BY METHOD"), html.indexOf("<h2>Competency by method</h2>"));
    check("8a. page 1 keeps the sign-off, one line per method, with how each was signed", /How signed/.test(page1) && /Electronically, name and password/.test(page1) && /Electronically, Example Hospital sign-in/.test(page1) && /From paper\. Binder C-4\. Recorded by B5 Morgan/.test(page1) && /Recorded in VeritaComp™, not electronically signed/.test(page1), page1.slice(0, 600));
    check("8b. an electronic signature prints the evaluator's name as a signature, with role and initials", /class="esig">Casey Tate<\/span><span class="sm">Technical Consultant, CT/.test(page1));
    check("8c. the signed entries say the observer signed, as themselves, and the record's fingerprint", /Signed by the observer, Casey Tate, TC, [^,]+, name and password/.test(html) && /Signed by the observer, Hana Ito, TC, [^,]+, Example Hospital sign-in/.test(html) && new RegExp(`Record ${row.record_fingerprint.slice(0, 4)} ${row.record_fingerprint.slice(4, 8)}`).test(html), html.slice(html.indexOf("Signed entries"), html.indexOf("Signed entries") + 400));
    const blockOf = (name: string) => { const at = html.indexOf(`${name} &middot;`); const next = html.indexOf('<div class="eblock">', at); return at < 0 ? "" : html.slice(at, next < 0 ? undefined : next); };
    check("8d. entries made before print as recorded, with nothing added", blockOf("CH-502 Made-up").length > 0 && !/Observer not signed|Signed by the observer/.test(blockOf("CH-502 Made-up")), blockOf("CH-502 Made-up").slice(0, 300));
    check("8e. a sign-off from paper says the observer's signature is on the paper", /Observer signed on paper \(Binder C-4\)/.test(blockOf("CH-503 Made-up")) && !/Observer not signed/.test(blockOf("CH-503 Made-up")), blockOf("CH-503 Made-up").slice(0, 600));
    check("8f. no em or en dashes in the record's new words", !new RegExp("[\\u2013\\u2014]").test(page1));
    const pdfRoute = await call("GET", `${L}/competency/employee/${sam}/record-pdf`, undefined, OWNER.token);
    check("8g. the record PDF route still renders", pdfRoute.s === 200 && !!pdfRoute.j.token, `${pdfRoute.s} ${JSON.stringify(pdfRoute.j).slice(0, 120)}`);

    // ── 9. The staff own-data limit still holds ─────────────────────────────────
    const caseyReadsSam = await call("GET", `${L}/competency/employee/${sam}`, undefined, CASEY.token);
    check("9a. signing doesn't open the other person's record to a Staff login", caseyReadsSam.s === 403 && caseyReadsSam.j.code === "STAFF_OWN_ONLY", `${caseyReadsSam.s}`);
    const samList = await toSign(SAM.token);
    check("9b. a Staff login who signs nothing sees nobody else's work", samList.me?.staffEmployeeId === sam && samList.observations.length === 0 && samList.methods.length === 0 && !/Tate|Chen|Ito/.test(JSON.stringify(samList)), JSON.stringify(samList));
    const exported = (await import("../../server/exportAllTables")).EXPORT_TABLES as any;
    const { PURGE_OVERRIDES } = await import("../../server/customerPurge");
    check("9c. the new table is in the lab's export and the customer purge", exported.competency_observation_signatures?.scope?.kind === "lab" && !!PURGE_OVERRIDES.competency_observation_signatures);
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
