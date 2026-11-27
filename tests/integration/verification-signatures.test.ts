// tests/integration/verification-signatures.test.ts
//
// B4 (2026-11-27; server/verificationSignatures.ts): a VeritaCheck verification plan signed before testing, the finished package
// signed, and single studies, package analytes and sign-off groups signed the same way: typed name, own password, role, and
// Accepted or Not accepted chosen. Boots the REAL routes on a scratch SQLite file with made-up labs and people and proves:
//   1. the plan: an editor writes it; the medical director and a designee with the duty sign it; an editor, the owner by ownership
//      alone, a designee without the duty, a Staff login and Veritas support can't; no password, a wrong one or a stale screen
//      signs nothing; another lab's or a sister lab's package is decided in its own lab
//   2. studies run before the plan's signature are named, on the signing read and on the package's page 1
//   3. a study, a package analyte and a sign-off group refuse initials without a password, refuse the wrong role, and take the full
//      signature (a Technical Consultant only at moderate complexity); the old gap: today's body { signature } alone is refused
//   4. a signed analyte locks its study slots until it is amended
//   5. the package: refused until every planned study is signed, by the wrong person, on a stale screen; signed by the director;
//      page 1 prints the signature, Accepted, and how it was signed
//   6. a change after signing keeps the old signature and its page and asks for a new one; a designee signs again and page 1 says
//      what it replaces; a plan changed after signing is a new version and the signed one stays
//   7. a study signed before this keeps its row and prints Accepted as main prints it, with how it was recorded, never
//      "electronically signed"
//   8. signing is decided by qualification, not edit access (B4 review): the director signs everything here from a view-only
//      seat; a view-only seat that is no director or designee, and an editor who isn't qualified, are refused
//   9. S0's check (server/eSignature.ts verifySigner): a designee whose domain requires the hospital's sign-in can't sign with a
//      password, signs with a fresh sign-in proof for this purpose (recorded sso with the hospital's name, printed so on page 1),
//      and the proof works once and for its own purpose only
// Run: npm run test:verification-signatures
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { inspectionWorld, type Login } from "./inspectionFixture";

const PW = ["In", "spect", "7x!"].join("-"); // inspectionFixture's made-up password
const WRONG_PW = ["Not", "Their", "9z!"].join("-"); // a password nobody has, for the wrong-password checks

async function main() {
  const w = await inspectionWorld("vsig");
  const { sqlite, call, check, seed, member, seat, login, one, all, audits, A, B, X, OWNER, OTHER, EDITOR, VIEWER, STAFF, SUPPORT, now, stamp } = w;
  const { buildStudyPdf } = await import("../../server/studyPdf");
  sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(A, A, OWNER.id);
  const today = new Date().toISOString().slice(0, 10);

  // ── People in lab A ─────────────────────────────────────────────────────────
  const person = async (key: string, name: string) => { const u = await login(key, name); member(A, u); seat(OWNER.id, u, A); return u; };
  // The director holds a VIEW-ONLY seat: signing is decided by the qualification, not edit access to VeritaCheck (section 8).
  const MD = await login("director", "Dana Director"); member(A, MD); seat(OWNER.id, MD, A, { type: "view_only", perms: { mode: "view_all" } });
  sqlite.prepare("UPDATE labs SET medical_director_email = ?, medical_director_name = 'Dana Director' WHERE id = ?").run(MD.email, A);
  const letter = (u: Login, position: string, duties: Record<string, boolean>, lab = A) => seed("director_delegations", {
    lab_id: lab, delegate_user_id: u.id, delegate_name: u.name, position, complexity_scope: "high", responsibilities_json: JSON.stringify(duties),
    signed_by_user_id: MD.id, signed_name: "Dana Director", signed_at: now, status: "active", created_at: now, updated_at: now,
  });
  const TS = await person("ts", "Terry Supervisor"); letter(TS, "technical_supervisor", { verify_method: true });
  const TC = await person("tc", "Casey Consultant"); letter(TC, "technical_consultant", { verify_method: true });
  const NODUTY = await person("noduty", "Noel Noduty"); letter(NODUTY, "technical_supervisor", { qc_period_cosign: true, finding_closure: true });
  // The director also edits sister lab B, where someone else is the director
  member(B, MD); seat(OWNER.id, MD, B);

  // VeritaMap: glucose and sodium are moderate, troponin high
  const map = seed("veritamap_maps", { user_id: OWNER.id, lab_id: A, name: "Made-up map", instruments: "[]" });
  for (const [analyte, complexity] of [["Glucose", "MODERATE"], ["Sodium", "MODERATE"], ["Troponin", "HIGH"]]) seed("veritamap_tests", { map_id: map, analyte, specialty: "Chemistry", complexity, active: 1, updated_at: now });

  const points = [[120, 121], [140, 139], [160, 161]].map(([e, s], i) => ({ level: i + 1, expectedValue: e, instrumentValues: { "Made-up CH-500": s } }));
  const study = (lab: number | null, name: string, date: string, more: Record<string, any> = {}) => seed("studies", {
    user_id: OWNER.id, lab_id: lab, test_name: name, instrument: "Made-up CH-500", analyst: "Ann Alyst", date, study_type: "cal_ver", clia_allowable_error: 4,
    tea_is_percentage: 0, tea_unit: "mmol/L", data_points: JSON.stringify(points), instruments: '["Made-up CH-500"]', status: "pass", created_at: now, ...more,
  });
  const S = (id: number) => one("SELECT * FROM studies WHERE id = ?", id);
  const full = (u: Login, decision: string | null = "accepted", more: Record<string, any> = {}) => ({ signature: u.name, password: PW, ...(decision ? { decision } : {}), ...more });
  const V = "/api/veritacheck/verifications";

  // A package in lab A: precision, accuracy and carryover; glucose and sodium
  const vA = Number((await call(EDITOR, "POST", `/api/labs/${A}/veritacheck/verifications`, {
    instrument_name: "Made-up CH-500", trigger_type: "new_instrument", elements: ["precision", "accuracy", "carryover"],
    element_reasons: { reportable_range: "Covered by the calibration verification", reference_interval: "Transferred from the analyzer in use", method_comparison: "First of this type in the lab" },
  })).j.id);
  const glu = Number((await call(EDITOR, "POST", `${V}/${vA}/analytes`, { analyte_name: "Glucose" }, A)).j.id);
  const na = Number((await call(EDITOR, "POST", `${V}/${vA}/analytes`, { analyte_name: "Sodium" }, A)).j.id);
  const slotOf = (v: number, element: string, analyteId: number | null) => one(`SELECT * FROM veritacheck_verification_studies WHERE verification_id = ? AND element = ? AND ${analyteId == null ? "analyte_id IS NULL" : "analyte_id = ?"}`, ...(analyteId == null ? [v, element] : [v, element, analyteId]));
  check("0. setup: a package in lab A with a slot per element and analyte", !!vA && !!slotOf(vA, "precision", glu) && !!slotOf(vA, "accuracy", na) && !!slotOf(vA, "carryover", null));
  const signing = async (u: Login, v = vA, lab = A) => call(u, "GET", `${V}/${v}/signing`, undefined, lab);

  // ── 1. The plan ─────────────────────────────────────────────────────────────
  const rows = [
    { element: "accuracy", analyte_ids: null, tested: "Glucose and sodium against the analyzer in use", criterion: "Lab-defined: glucose 8%, sodium 3 mmol/L", specimens: "20 patient specimens each" },
    { element: "precision", analyte_ids: [glu, na], tested: "Two control levels, 5 days by 5 replicates", criterion: "2 SD within the limits above", specimens: "25 per level" },
    { element: "carryover", analyte_ids: null, tested: "High then low sample", criterion: "Low result within 2 SD", specimens: "3 high, 3 low" },
  ];
  const s0 = (await signing(EDITOR)).j;
  check("1a. before a plan: no plan, and an editor can't sign", s0.plan === null && s0.signAs.canSign === false && /Letter of Delegation/.test(s0.signAs.reason), JSON.stringify(s0.signAs));
  const mdView = (await signing(MD)).j;
  const names = mdView.whoCanSign.map((x: any) => x.name).sort().join(", ");
  check("1a. the director signs as the medical director; who can sign lists the director and the designees with the duty", mdView.signAs.canSign && mdView.signAs.label === "Medical director" && names === "Casey Consultant, Dana Director, Terry Supervisor", names);
  const otherPkg = seed("veritacheck_verifications", { user_id: OWNER.id, lab_id: A, instrument_name: "Another", trigger_type: "new_instrument", elements: '["precision"]' });
  const otherAnalyte = seed("veritacheck_verification_analytes", { verification_id: otherPkg, analyte_name: "Potassium", created_at: now, updated_at: now });
  const badRows = [[{ ...rows[0], element: "reportable_range" }], [{ ...rows[1], analyte_ids: [otherAnalyte] }], [], [rows[0], rows[0]]];
  for (const b of badRows) {
    const r = await call(EDITOR, "PUT", `${V}/${vA}/plan`, { rows: b }, A);
    check(`1b. a plan with ${JSON.stringify(b).slice(0, 60)}... is refused`, r.s === 400 && !one("SELECT 1 AS x FROM veritacheck_verification_plans WHERE verification_id = ?", vA), `${r.s} ${r.text}`);
  }
  const put = await call(EDITOR, "PUT", `${V}/${vA}/plan`, { rows }, A);
  check("1b. an editor writes the plan: version 1, unsigned", put.s === 200 && put.j.version === 1 && one("SELECT signed_at FROM veritacheck_verification_plans WHERE verification_id = ?", vA)?.signed_at === null, put.text);
  check("1b. the save writes the module's audit row", audits("verification_plan").some((a) => a.module === "veritacheck" && a.action === "create" && a.user_id === EDITOR.id));
  const plan1 = (await signing(EDITOR)).j.plan;
  const planRow = () => JSON.stringify(one("SELECT * FROM veritacheck_verification_plans WHERE verification_id = ? ORDER BY version DESC LIMIT 1", vA));
  const p0 = planRow();
  const signPlan = (u: Login, body: any, v = vA, lab = A) => call(u, "POST", `${V}/${v}/plan/sign`, body, lab);
  for (const [who, u, codes] of [["an editor", EDITOR, [403]], ["a view-only seat, no director or designee", VIEWER, [403]], ["the owner, by ownership alone", OWNER, [403]], ["a designee without the duty", NODUTY, [403]], ["a Staff login", STAFF, [403]], ["Veritas support", SUPPORT, [403, 404]]] as const) {
    const r = await signPlan(u, { ...full(u, null), expect_rows_hash: plan1.rows_hash });
    check(`1c. ${who} can't sign the plan`, (codes as readonly number[]).includes(r.s) && planRow() === p0, `${r.s} ${r.text}`);
  }
  const noPw = await signPlan(MD, { signature: "DD", expect_rows_hash: plan1.rows_hash });
  const wrongPw = await signPlan(MD, { signature: MD.name, password: WRONG_PW, expect_rows_hash: plan1.rows_hash });
  const stale = await signPlan(MD, { ...full(MD, null), expect_rows_hash: "0".repeat(64) });
  check("1c. the director's initials without a password, a wrong password and a stale screen sign nothing", noPw.s === 400 && /password/i.test(noPw.j.error) && wrongPw.s === 401 && stale.s === 409 && stale.j.code === "MOVED" && planRow() === p0, `${noPw.s} ${wrongPw.s} ${stale.s}`);
  // Another customer's package, and a package in the sister lab where the director only edits
  const vX = seed("veritacheck_verifications", { user_id: OTHER.id, lab_id: X, instrument_name: "Theirs", trigger_type: "new_instrument", elements: '["precision"]' });
  const vB = seed("veritacheck_verifications", { user_id: OWNER.id, lab_id: B, instrument_name: "Sister", trigger_type: "new_instrument", elements: '["precision"]' });
  for (const [v, lab] of [[vX, X], [vB, B]]) seed("veritacheck_verification_plans", { verification_id: v, lab_id: lab, version: 1, rows_json: JSON.stringify([rows[1]].map((r) => ({ ...r, analyte_ids: null }))), created_at: now, updated_at: now });
  const hashOf = async (v: number, lab: number) => (await call(OWNER, "GET", `${V}/${v}/signing`, undefined, lab)).j.plan?.rows_hash;
  const rX = await signPlan(MD, { ...full(MD, null), expect_rows_hash: "x" }, vX, A);
  const rB = await signPlan(MD, { ...full(MD, null), expect_rows_hash: await hashOf(vB, B) }, vB, B);
  check("1d. another customer's package is answered as not there", [403, 404].includes(rX.s) && one("SELECT signed_at FROM veritacheck_verification_plans WHERE verification_id = ?", vX).signed_at === null, `${rX.s}`);
  check("1d. in the sister lab the director of A is an editor, not its director: refused there", rB.s === 403 && rB.j.code === "NOT_DIRECTOR_OR_DESIGNEE" && one("SELECT signed_at FROM veritacheck_verification_plans WHERE verification_id = ?", vB).signed_at === null, `${rB.s} ${rB.text}`);

  // ── 2. Testing before the plan is signed (Q1) ─────────────────────────────
  // Studies are run and linked before the plan is signed; one is dated before the plan's signature.
  const sGluPrec = study(A, "Glucose", "2026-01-10"), sNaPrec = study(A, "Sodium", today), sGluAcc = study(A, "Glucose", today), sNaAcc = study(A, "Sodium", today), sCarry = study(A, "Glucose", today);
  const link = (slot: any, id: number) => call(EDITOR, "PATCH", `${V}/${vA}/studies/${slot.id}`, { study_id: id, passed: 1 }, A);
  for (const [s, id] of [[slotOf(vA, "precision", glu), sGluPrec], [slotOf(vA, "precision", na), sNaPrec], [slotOf(vA, "accuracy", glu), sGluAcc], [slotOf(vA, "carryover", null), sCarry]] as const) await link(s, id);
  const before0 = (await signing(EDITOR)).j;
  check("2a. while the plan isn't signed, every linked study counts as run before it", before0.planSigned === false && before0.beforePlan.length === 4, JSON.stringify(before0.beforePlan));
  const tsPlan = await signPlan(TS, { ...full(TS, null), expect_rows_hash: plan1.rows_hash });
  const p1 = one("SELECT * FROM veritacheck_verification_plans WHERE verification_id = ? AND version = 1", vA);
  check("1e. a Technical Supervisor named in a signed letter with the duty signs the plan", tsPlan.s === 200 && p1.signed_by_user_id === TS.id && p1.capacity === "designee" && p1.capacity_label === "Designee, Technical Supervisor (high complexity)" && p1.signed_with === "password", `${tsPlan.s} ${tsPlan.text}`);
  check("1e. the plan's signature writes the module's audit row", audits("verification_plan_signature", p1.id).length === 1);
  const after = (await signing(EDITOR)).j;
  check("2b. once it's signed, only the study dated before the signature is named", after.beforePlan.length === 1 && after.beforePlan[0].label === "Precision, Glucose" && after.beforePlan[0].date === "2026-01-10", JSON.stringify(after.beforePlan));

  // ── 3. Single studies, analytes and sign-off groups ───────────────────────
  const signStudy = (u: Login, id: number, body: any, lab = A, scoped = true) => call(u, "POST", scoped ? `/api/labs/${lab}/studies/${id}/finalize` : `/api/studies/${id}/finalize`, body, lab);
  for (const scoped of [true, false]) {
    const r = await signStudy(MD, sNaAcc, { signature: "DD" }, A, scoped);
    check(`3a. ${scoped ? "lab route" : "older route"}: the old body, initials and no password, is refused and the study stays a draft`, r.s === 400 && /password/i.test(r.j.error) && S(sNaAcc).lifecycle_state === "draft", `${r.s} ${r.text}`);
  }
  const noDecision = await signStudy(MD, sNaAcc, full(MD, null));
  check("3a. nothing is chosen for the signer: no Accepted or Not accepted is refused", noDecision.s === 400 && noDecision.j.code === "DECISION_REQUIRED" && S(sNaAcc).lifecycle_state === "draft");
  for (const [who, u, codes] of [["an editor", EDITOR, [403]], ["a view-only seat, no director or designee", VIEWER, [403]], ["the owner", OWNER, [403]], ["a designee without the duty", NODUTY, [403]], ["a Staff login", STAFF, [403]], ["Veritas support", SUPPORT, [403]]] as const) {
    const r = await signStudy(u, sNaAcc, full(u));
    check(`3b. ${who} can't sign a study, even with a password`, (codes as readonly number[]).includes(r.s) && S(sNaAcc).lifecycle_state === "draft", `${r.s} ${r.text}`);
  }
  const asMd = (await call(MD, "GET", `/api/labs/${A}/studies/${sNaAcc}/sign-as`)).j, asEd = (await call(EDITOR, "GET", `/api/labs/${A}/studies/${sNaAcc}/sign-as`)).j;
  check("3b. the study's sign-as read says who signs as what", asMd.canSign === true && asMd.label === "Medical director" && asEd.canSign === false);
  for (const id of [sGluPrec, sNaPrec, sGluAcc, sCarry]) await signStudy(MD, id, full(MD));
  const mdStudy = await signStudy(MD, sNaAcc, full(MD, "accepted"));
  const row = S(sNaAcc);
  check("3c. the director's full signature: finalized with name, decision, role and how", mdStudy.s === 200 && row.lifecycle_state === "finalized" && row.finalized_signature === MD.name && row.finalized_decision === "accepted" && row.signed_with === "password" && row.finalized_capacity === "medical_director", `${mdStudy.s} ${mdStudy.text.slice(0, 200)}`);
  check("3c. and the module's audit row", audits("study_signature", sNaAcc).length === 1 && audits("study_signature", sNaAcc)[0].user_id === MD.id);
  const trop = study(A, "Troponin", today, { status: "draft" }), na2 = study(A, "Sodium", today, { status: "draft" });
  const tcHigh = await signStudy(TC, trop, full(TC)), tcMod = await signStudy(TC, na2, full(TC, "not_accepted"));
  check("3d. a Technical Consultant with the duty can't sign a high complexity study", tcHigh.s === 403 && S(trop).lifecycle_state === "draft", `${tcHigh.s}`);
  check("3d. and signs a moderate one, as a designee, Not accepted as chosen", tcMod.s === 200 && S(na2).finalized_capacity_label === "Designee, Technical Consultant (moderate complexity)" && S(na2).finalized_decision === "not_accepted", `${tcMod.s} ${tcMod.text.slice(0, 200)}`);
  // A sign-off group
  const g1 = study(A, "Glucose", today, { status: "draft" }), g2 = study(A, "Sodium", today, { status: "draft" });
  const group = Number((await call(EDITOR, "POST", `/api/labs/${A}/veritacheck/signoff-groups`, { name: "Made-up group" })).j.id);
  await call(EDITOR, "POST", `/api/labs/${A}/veritacheck/signoff-groups/${group}/studies`, { studyIds: [g1, g2] });
  const gSign = (u: Login, body: any) => call(u, "POST", `/api/labs/${A}/veritacheck/signoff-groups/${group}/sign`, body);
  const gOld = await gSign(MD, { signature: "DD" }), gEd = await gSign(EDITOR, full(EDITOR)), gSup = await gSign(SUPPORT, full(SUPPORT)), gVi = await gSign(VIEWER, full(VIEWER)), gSt = await gSign(STAFF, full(STAFF));
  const stillDraft = () => S(g1).lifecycle_state === "draft" && S(g2).lifecycle_state === "draft" && one("SELECT status FROM study_signoff_groups WHERE id = ?", group).status === "open";
  check("3e. a sign-off group: initials only, an editor, a view-only seat, a Staff login and Veritas support sign nothing", gOld.s === 400 && gEd.s === 403 && gSup.s === 403 && gVi.s === 403 && gSt.s === 403 && stillDraft(), `${gOld.s} ${gEd.s} ${gSup.s} ${gVi.s} ${gSt.s}`);
  const gOk = await gSign(MD, full(MD, "not_accepted"));
  const grp = one("SELECT * FROM study_signoff_groups WHERE id = ?", group);
  check("3e. the director's full signature signs every study in it, each with its own record", gOk.s === 200 && gOk.j.signed === 2 && [g1, g2].every((id) => S(id).signed_with === "password" && S(id).finalized_decision === "not_accepted") && grp.signed_with === "password" && grp.signed_capacity_label === "Medical director", `${gOk.s} ${gOk.text}`);
  // A package analyte
  const aSign = (u: Login, v: number, a: number, body: any) => call(u, "POST", `${V}/${v}/analytes/${a}/finalize`, body, A);
  const vL = Number((await call(EDITOR, "POST", `/api/labs/${A}/veritacheck/verifications`, { instrument_name: "Made-up lock test", trigger_type: "new_instrument", elements: ["precision", "carryover"], element_reasons: {} })).j.id);
  const lGlu = Number((await call(EDITOR, "POST", `${V}/${vL}/analytes`, { analyte_name: "Glucose" }, A)).j.id);
  const lNa = Number((await call(EDITOR, "POST", `${V}/${vL}/analytes`, { analyte_name: "Sodium" }, A)).j.id);
  const aRow = (id: number) => one("SELECT * FROM veritacheck_verification_analytes WHERE id = ?", id);
  const aOld = await aSign(MD, vL, lGlu, { signature: "DD" }), aEd = await aSign(EDITOR, vL, lGlu, full(EDITOR)), aOwner = await aSign(OWNER, vL, lGlu, full(OWNER)), aVi = await aSign(VIEWER, vL, lGlu, full(VIEWER));
  check("3f. a package analyte: the old body, an editor, the owner and a view-only seat sign nothing", aOld.s === 400 && aEd.s === 403 && aOwner.s === 403 && aVi.s === 403 && aRow(lGlu).lifecycle_state === "draft", `${aOld.s} ${aEd.s} ${aOwner.s} ${aVi.s}`);
  const aOk = await aSign(TS, vL, lGlu, full(TS));
  check("3f. a designee with the duty signs it with the full signature", aOk.s === 200 && aRow(lGlu).lifecycle_state === "finalized" && aRow(lGlu).signed_with === "password" && aRow(lGlu).finalized_decision === "accepted" && audits("verification_analyte_signature", lGlu).length === 1, `${aOk.s} ${aOk.text}`);

  // ── 4. A signed analyte locks its study slots ─────────────────────────────
  const lSlot = slotOf(vL, "precision", lGlu), lOther = slotOf(vL, "precision", lNa), lWide = slotOf(vL, "carryover", null);
  const lockStudy = study(A, "Glucose", today);
  const slotRow = (id: number) => JSON.stringify(one("SELECT * FROM veritacheck_verification_studies WHERE id = ?", id));
  const l0 = slotRow(lSlot.id), w0 = slotRow(lWide.id);
  const patchL = (s: any, body: any) => call(EDITOR, "PATCH", `${V}/${vL}/studies/${s.id}`, body, A);
  const locked = await patchL(lSlot, { study_id: lockStudy, passed: 1 }), lockedNote = await patchL(lSlot, { design_rationale: "changed" }), lockedWide = await patchL(lWide, { study_id: lockStudy });
  check("4a. the signed analyte's slot refuses a link and any other change, and the instrument-wide slot covering it too", locked.s === 409 && locked.j.code === "ANALYTE_SIGNED" && lockedNote.s === 409 && lockedWide.s === 409 && slotRow(lSlot.id) === l0 && slotRow(lWide.id) === w0, `${locked.s} ${lockedNote.s} ${lockedWide.s}`);
  check("4b. an unsigned analyte's slot still changes", (await patchL(lOther, { study_id: lockStudy, passed: 1 })).s === 200);
  const amend = await call(EDITOR, "POST", `${V}/${vL}/analytes/${lGlu}/amend`, {}, A);
  check("4c. once the analyte is amended, its slot can change again", amend.s === 200 && (await patchL(lSlot, { study_id: lockStudy, passed: 1 })).s === 200 && aRow(lGlu).lifecycle_state === "finalized");

  // ── 5. The package ────────────────────────────────────────────────────────
  const pkgSign = async (u: Login, body: any, expectFrom: Login = MD) => {
    const st = (await signing(expectFrom)).j;
    return call(u, "POST", `${V}/${vA}/sign`, { expect: { fingerprint: st.fingerprint, parts: st.parts }, ...body }, A);
  };
  const sigCount = () => one("SELECT COUNT(*) AS n FROM veritacheck_verification_signatures WHERE verification_id = ?", vA).n;
  const notReady = await pkgSign(MD, full(MD));
  check("5a. not signed while a planned study has none: it says which", notReady.s === 409 && notReady.j.code === "NOT_READY" && notReady.j.missing.some((m: string) => m === "Accuracy / Bias, Sodium: no study linked") && sigCount() === 0, JSON.stringify(notReady.j));
  const stalePkg = (await signing(MD)).j;
  await link(slotOf(vA, "accuracy", na), sNaAcc);
  const moved = await call(MD, "POST", `${V}/${vA}/sign`, { ...full(MD), expect: { fingerprint: stalePkg.fingerprint, parts: stalePkg.parts } }, A);
  check("5b. a screen opened before a change signs nothing and names what moved", moved.s === 409 && moved.j.code === "MOVED" && moved.j.moved.includes("Accuracy / Bias, Sodium") && /Not signed\. Accuracy \/ Bias, Sodium was changed after you opened this page/.test(moved.j.error) && sigCount() === 0, JSON.stringify(moved.j));
  for (const [who, u, codes] of [["an editor", EDITOR, [403]], ["a view-only seat, no director or designee", VIEWER, [403]], ["the owner, by ownership alone", OWNER, [403]], ["a designee without the duty", NODUTY, [403]], ["a Staff login", STAFF, [403]], ["Veritas support", SUPPORT, [403, 404]]] as const) {
    const r = await pkgSign(u, full(u));
    check(`5c. ${who} can't sign the package`, (codes as readonly number[]).includes(r.s) && sigCount() === 0, `${r.s} ${r.text}`);
  }
  const pNoPw = await pkgSign(MD, { signature: "DD", decision: "accepted" }), pNoDec = await pkgSign(MD, full(MD, null)), pWrong = await pkgSign(MD, { ...full(MD), password: WRONG_PW });
  check("5c. the director: no password, no choice, or a wrong password signs nothing", pNoPw.s === 400 && pNoDec.s === 400 && pWrong.s === 401 && pWrong.j.error === "Password incorrect; signature not recorded" && sigCount() === 0, `${pNoPw.s} ${pNoDec.s} ${pWrong.s}`);
  const signed = await pkgSign(MD, full(MD, "accepted", { title: "Medical director" }));
  const sig1 = one("SELECT * FROM veritacheck_verification_signatures WHERE verification_id = ?", vA);
  check("5d. the director signs the package: name, role, Accepted, the fingerprint, the page kept", signed.s === 200 && sig1?.signed_by_user_id === MD.id && sig1.decision === "accepted" && sig1.capacity === "medical_director" && sig1.signed_with === "password" && /Dana Director/.test(sig1.page_html || "") && audits("verification_signature", sig1.id).length === 1, `${signed.s} ${signed.text}`);
  const covers = JSON.parse(sig1.covers_json);
  check("5d. what it covers: the plan, 5 of 5 studies, the one tested before the plan, what was left out", covers.planVersion === 1 && covers.studies.total === 5 && covers.studies.signed === 5 && covers.beforePlan.length === 1 && covers.leftOut.length === 3, JSON.stringify(covers));
  const again = await pkgSign(MD, full(MD));
  check("5e. nothing changed: no second signature", again.s === 409 && again.j.code === "ALREADY_SIGNED" && sigCount() === 1);
  const pdfText = async (p: string, page1 = true) => {
    const r = await call(OWNER, "POST", p, {}, A);
    if (r.s !== 200) return `HTTP ${r.s} ${r.text.slice(0, 200)}`;
    const file = path.join(os.tmpdir(), `vsig-${stamp}-${Math.random().toString(36).slice(2)}.pdf`);
    fs.writeFileSync(file, r.buf);
    const code = page1 ? "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(fitz.open(sys.argv[1])[0].get_text())" : "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(' '.join(p.get_text() for p in fitz.open(sys.argv[1])))";
    try { return execFileSync("python", ["-E", "-c", code, file]).toString("utf-8").replace(/\s+/g, " "); } finally { fs.unlinkSync(file); }
  };
  const short = (await signing(MD)).j.short;
  const page1 = await pdfText(`${V}/${vA}/pdf`);
  check("5f. page 1 of the package: Signed, the plan's signature, the study tested before it", /Package Status Signed/.test(page1) && /Verification plan Signed .*Terry Supervisor/.test(page1) && /Tested before the plan 1 of 5 studies: Precision, Glucose, 01\/10\/2026/.test(page1), page1.slice(0, 900));
  check("5f. page 1: the review block with Accepted marked, the signature and how it was signed", /LABORATORY DIRECTOR OR DESIGNEE REVIEW/.test(page1) && /☑ Accepted for patient testing/.test(page1) && /Dana Director/.test(page1) && /\(electronically signed\)/.test(page1) && page1.includes(`Signed in VeritaCheck® with name and password, as the medical director. Record ${short}`), page1.slice(0, 1600));
  const all1 = await pdfText(`${V}/${vA}/pdf`, false);
  check("5f. the plan prints after page 1, with its own signature", /Verification Plan .*I approve this plan for verifying the performance of this instrument\/test\. Signed .* by Terry Supervisor, Designee, Technical Supervisor \(high complexity\)/.test(all1), all1.slice(0, 300));

  // ── 6. A change after signing ─────────────────────────────────────────────
  // The sodium accuracy study is amended, and the amendment is signed and linked in its place.
  const am = await call(EDITOR, "POST", `/api/labs/${A}/studies/${sNaAcc}/amend`, {});
  const amId = Number(am.j?.id);
  await signStudy(MD, amId, full(MD));
  const changed = (await signing(MD)).j;
  check("6a. after the amendment the signature no longer covers the package, and it says what changed", changed.current === false && changed.changed.includes("Accuracy / Bias, Sodium") && changed.history.length === 1 && sigCount() === 1, JSON.stringify(changed.changed));
  const p1Changed = await pdfText(`${V}/${vA}/pdf`);
  check("6a. page 1 says so; the old signature stays on the record and isn't shown as covering it", /Package Status Changed since it was signed/.test(p1Changed) && /no longer covers this package/.test(p1Changed) && /needs to be signed again/.test(p1Changed) && !/\(electronically signed\)/.test(p1Changed), p1Changed.slice(0, 1600));
  const kept = await pdfText(`${V}/${vA}/signatures/${sig1.id}/pdf`);
  check("6b. the page it was signed on is kept and prints as signed", /Package Status Signed/.test(kept) && /\(electronically signed\)/.test(kept) && kept.includes(`Record ${short}`), kept.slice(0, 400));
  const notReady2 = await pkgSign(TS, full(TS));
  check("6c. the superseded study has to be replaced first", notReady2.s === 409 && notReady2.j.missing.some((m: string) => /Accuracy \/ Bias, Sodium: linked study was replaced by an amendment/.test(m)), JSON.stringify(notReady2.j));
  await link(slotOf(vA, "accuracy", na), amId);
  const resign = await pkgSign(TS, full(TS, "accepted"));
  const sig2 = one("SELECT * FROM veritacheck_verification_signatures WHERE verification_id = ? ORDER BY id DESC LIMIT 1", vA);
  check("6c. a designee with the duty signs it again; the new one replaces the old, which is kept", resign.s === 200 && sig2.id !== sig1.id && sig2.replaces_signature_id === sig1.id && sig2.capacity === "designee" && sigCount() === 2 && JSON.stringify(one("SELECT * FROM veritacheck_verification_signatures WHERE id = ?", sig1.id)) === JSON.stringify(sig1), `${resign.s} ${resign.text}`);
  const p1Again = await pdfText(`${V}/${vA}/pdf`);
  check("6c. page 1: signed again by the designee, and what it replaces", /Package Status Signed/.test(p1Again) && /Terry Supervisor/.test(p1Again) && /as a designee, Technical Supervisor \(high complexity\)/.test(p1Again) && /Replaces the signature of \d\d\/\d\d\/\d{4}/.test(p1Again), p1Again.slice(0, 1600));
  // The plan changes after signing: a new version; the signed one stays
  const rows2 = rows.map((r) => (r.element === "precision" ? { ...r, specimens: "30 per level" } : r));
  const put2 = await call(EDITOR, "PUT", `${V}/${vA}/plan`, { rows: rows2 }, A);
  const v1 = one("SELECT * FROM veritacheck_verification_plans WHERE verification_id = ? AND version = 1", vA);
  check("6d. a plan changed after signing is version 2; version 1 keeps its signature and rows", put2.s === 200 && put2.j.version === 2 && v1.signed_at === p1.signed_at && v1.rows_json === p1.rows_json, put2.text);
  const blocked = await pkgSign(MD, full(MD));
  check("6d. the package can't be signed again until the new plan is", blocked.s === 409 && blocked.j.code === "PLAN_NOT_SIGNED", `${blocked.s}`);
  const mdPlan = await signPlan(MD, { ...full(MD, null), expect_rows_hash: (await signing(MD)).j.plan.rows_hash });
  check("6d. the director signs version 2; version 1 is marked replaced", mdPlan.s === 200 && one("SELECT capacity FROM veritacheck_verification_plans WHERE verification_id = ? AND version = 2", vA).capacity === "medical_director" && !!one("SELECT superseded_at FROM veritacheck_verification_plans WHERE id = ?", v1.id).superseded_at, mdPlan.text);
  check("6d. studies before the plan are still counted from its first signature", (await signing(MD)).j.beforePlan.length === 1);

  // ── 7. Studies signed before this ────────────────────────────────────────
  const legacy = study(A, "Sodium", "2026-06-01", { lifecycle_state: "finalized", finalized_signature: "MV", finalized_at: "2026-06-02T15:00:00.000Z", finalized_by_user_id: EDITOR.id });
  const legacyRow = JSON.stringify(S(legacy));
  const labRow = one("SELECT * FROM labs WHERE id = ?", A), ownerRow = one("SELECT * FROM users WHERE id = ?", OWNER.id);
  const studyPage1 = async (id: number) => {
    const { buffer } = await buildStudyPdf(sqlite, S(id), labRow, ownerRow);
    const file = path.join(os.tmpdir(), `vsig-study-${stamp}-${id}.pdf`);
    fs.writeFileSync(file, buffer);
    try { return execFileSync("python", ["-E", "-c", "import sys, fitz\nsys.stdout.reconfigure(encoding='utf-8')\nprint(fitz.open(sys.argv[1])[0].get_text())", file]).toString("utf-8").replace(/\s+/g, " "); } finally { fs.unlinkSync(file); }
  };
  const lp = await studyPage1(legacy);
  check("7a. a study signed before keeps its row exactly", JSON.stringify(S(legacy)) === legacyRow && S(legacy).signed_with === null);
  check("7a. a passing one signed before prints Accepted as main does, with how it was recorded, never 'electronically signed'", /LABORATORY DIRECTOR OR DESIGNEE REVIEW/i.test(lp) && /☑ Accepted for patient testing/.test(lp) && /MV/.test(lp) && /typed, not a password signature/.test(lp) && /Recorded in VeritaCheck® on 2026-06-02 with a typed name and no password or role check/.test(lp) && !/electronically signed/.test(lp), lp.slice(0, 2400));
  const legacyFail = study(A, "Sodium", "2026-06-01", { status: "fail", lifecycle_state: "finalized", finalized_signature: "MV", finalized_at: "2026-06-02T15:00:00.000Z", finalized_by_user_id: EDITOR.id });
  const lf = await studyPage1(legacyFail);
  check("7a. a failing one signed before leaves the boxes unmarked, as main does", !/☑/.test(lf) && /Recorded in VeritaCheck® on 2026-06-02 with a typed name/.test(lf) && !/electronically signed/.test(lf), lf.slice(0, 2400));
  const ep = await studyPage1(sNaPrec);
  check("7b. a study signed now: page 1 marks Accepted, electronically signed, title and how", /☑ Accepted for patient testing/.test(ep) && /\(electronically signed\)/.test(ep) && /Signed in VeritaCheck® with name and password, as the medical director\./.test(ep) && /Medical director/.test(ep), ep.slice(0, 2400));
  const np = await studyPage1(na2);
  check("7b. Not accepted prints as the signer chose it", /☑ Not accepted/.test(np) && /as a designee, Technical Consultant \(moderate complexity\)/.test(np), np.slice(0, 2400));

  // ── 8. Qualification, not edit access (B4 review) ───────────────────────
  const mdSeat = one("SELECT seat_type, permissions FROM user_seats WHERE seat_user_id = ? AND lab_id = ?", MD.id, A);
  check("8a. the director who signed everything above holds a view-only seat", mdSeat?.seat_type === "view_only" && S(sNaAcc).finalized_by_user_id === MD.id && sig1.signed_by_user_id === MD.id, JSON.stringify(mdSeat));
  const q1 = study(A, "Sodium", today, { status: "draft" }), q2 = study(A, "Sodium", today, { status: "draft" });
  const vi = await signStudy(VIEWER, q1, full(VIEWER)), ed = await signStudy(EDITOR, q1, full(EDITOR)), st = await signStudy(STAFF, q1, full(STAFF)), viOld = await signStudy(VIEWER, q1, full(VIEWER), A, false);
  check("8b. a view-only seat that is no director or designee is refused for its qualification, on both routes", vi.s === 403 && vi.j.code === "NOT_DIRECTOR_OR_DESIGNEE" && viOld.s === 403 && viOld.j.code === "NOT_DIRECTOR_OR_DESIGNEE" && S(q1).lifecycle_state === "draft", `${vi.s} ${vi.text} | ${viOld.s} ${viOld.text}`);
  check("8c. an editor who isn't qualified is still refused, for the same reason", ed.s === 403 && ed.j.code === "NOT_DIRECTOR_OR_DESIGNEE" && S(q1).lifecycle_state === "draft", `${ed.s} ${ed.text}`);
  check("8d. a Staff login is refused as a Staff login", st.s === 403 && S(q1).lifecycle_state === "draft", `${st.s} ${st.text}`);
  const asViewer = (await call(MD, "GET", `/api/labs/${A}/studies/${q2}/sign-as`)).j;
  const mdOld = await signStudy(MD, q2, full(MD, "accepted"), A, false);
  check("8e. the director on a view-only seat signs as the medical director on the older route too", asViewer.canSign === true && asViewer.label === "Medical director" && mdOld.s === 200 && S(q2).finalized_capacity === "medical_director", `${mdOld.s} ${mdOld.text.slice(0, 200)}`);
  // A director of lab A on a view-only seat, with no membership in another customer's lab, can't sign there.
  const xStudy = study(X, "Sodium", today, { status: "draft", user_id: OTHER.id });
  const xs = await signStudy(MD, xStudy, full(MD), A, false);
  check("8f. another customer's study is not theirs to sign", [403, 404].includes(xs.s) && S(xStudy).lifecycle_state === "draft", `${xs.s}`);

  // ── 9. Signing with the hospital's sign-in (S0) ───────────────────────────
  // A Technical Supervisor of lab A, on a view-only seat, whose made-up email domain requires the made-up hospital's sign-in.
  const hospitalEmail = `vsig-hana-${stamp}@vsig-hospital.test`;
  const hreg = await call(null, "POST", "/api/auth/register", { email: hospitalEmail, password: PW, name: "Hana Hospital", hipaa_acknowledged: true });
  const HOSP: Login = { id: Number(one("SELECT id FROM users WHERE email = ?", hospitalEmail).id), email: hospitalEmail, name: "Hana Hospital", token: hreg.j.token };
  member(A, HOSP); seat(OWNER.id, HOSP, A, { type: "view_only", perms: { mode: "view_all" } });
  letter(HOSP, "technical_supervisor", { verify_method: true });
  const cfgId = seed("sso_configs", { name: "Example Hospital", issuer: "https://login.example.test/tenant/v2.0", client_id: "made-up-client", email_domains: JSON.stringify(["vsig-hospital.test"]), required: 1, enabled: 1, created_at: now, updated_at: now });
  const method = (await call(HOSP, "GET", "/api/auth/signature/method", undefined, A)).j;
  check("9a. S0 says this person signs with the hospital's sign-in only", method?.password === false && method?.sso?.name === "Example Hospital" && method?.sso?.required === true, JSON.stringify(method));
  const h1 = study(A, "Sodium", today, { status: "draft" }), h2 = study(A, "Sodium", today, { status: "draft" });
  const pwTry = await signStudy(HOSP, h1, full(HOSP));
  check("9b. a password can't sign where the hospital's sign-in is required, and nothing is recorded", pwTry.s === 403 && pwTry.j.code === "SSO_SIGN_REQUIRED" && S(h1).lifecycle_state === "draft", `${pwTry.s} ${pwTry.text}`);
  // The proof S0's round trip hands the screen (POST /api/auth/signature/sso/complete), made here as that route stores it.
  const proofFor = (purpose: string) => {
    const proof = crypto.randomBytes(32).toString("base64url");
    seed("signature_sso_requests", { user_id: HOSP.id, purpose, config_id: cfgId, created_at: now, provider_name: "Example Hospital", signed_in_at: now,
      handed_at: now, proof_hash: crypto.createHash("sha256").update(proof).digest("hex"), proof_expires_at: new Date(Date.now() + 120000).toISOString() });
    return proof;
  };
  const wrongPurpose = await signStudy(HOSP, h1, { signature: HOSP.name, ssoProof: proofFor("verification_package"), decision: "accepted" });
  check("9c. a proof asked for a package can't sign a study", wrongPurpose.s === 401 && S(h1).lifecycle_state === "draft", `${wrongPurpose.s} ${wrongPurpose.text}`);
  const proof = proofFor("verification_study");
  const hs = await signStudy(HOSP, h1, { signature: HOSP.name, ssoProof: proof, decision: "accepted" });
  check("9d. a fresh hospital sign-in signs it, recorded sso with the hospital's name, as the designee", hs.s === 200 && S(h1).signed_with === "sso" && S(h1).signed_with_provider === "Example Hospital" && S(h1).finalized_capacity === "designee", `${hs.s} ${hs.text.slice(0, 200)}`);
  const reuse = await signStudy(HOSP, h2, { signature: HOSP.name, ssoProof: proof, decision: "accepted" });
  check("9e. the same proof doesn't sign a second time", reuse.s === 401 && S(h2).lifecycle_state === "draft", `${reuse.s}`);
  const hp = await studyPage1(h1);
  check("9f. page 1 says how it was signed: with the hospital's sign-in, as the designee", /\(electronically signed\)/.test(hp) && /Signed in VeritaCheck® with Example Hospital sign-in, as a designee, Technical Supervisor \(high complexity\)\./.test(hp), hp.slice(0, 2400));
  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
