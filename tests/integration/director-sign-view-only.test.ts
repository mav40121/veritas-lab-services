// tests/integration/director-sign-view-only.test.ts
//
// BUG-204 (2026-11-27; server/qualifiedSigning.ts): medical directors and their designees are usually on view-only seats, and
// authMiddleware's view_only gate refused every write from one, so the monthly QC co-sign answered `view_only_seat` before its
// own director-or-designee check ran, while the screen told the director they could co-sign. The signatures that decide by the
// signer's qualification in the record's own laboratory now pass the gate, through the one allow-list B4 started. Boots the REAL
// routes on a scratch SQLite file with made-up labs and people and proves:
//   1. the QC co-sign: the medical director on a view-only seat co-signs a filed review, and so does a designee on a view-only
//      seat holding the qc_period_cosign duty; the old gap (main 694d2d82's allow-list sends the request to view_only_seat); a
//      view-only seat with no director role or duty gets the route's own 403; the owner override is as it was
//   2. the same view-only director is still refused filing the review, the co-sign setting, the QC rules and their lock, and an
//      ordinary write in another module; a path that only looks like the co-sign is refused too
//   3. another lab's director, the director in a sister lab where someone else directs, and Veritas support can't co-sign
//   4. the other signatures added: a finding's sign-off, the VeritaMaintain monthly review, and VeritaComp's observer and
//      method sign-off (a sign-off entered from paper still needs edit); each refuses a view-only seat that isn't qualified
//   5. the BUG-188 read-and-sign runs on the Staff session, which has no view-only gate: not blocked, nothing to add
//   6. the allow-list reaches exactly the routes it names, POST only, ids as digits (read from Express's own routes)
// Run: npm run test:director-sign-view-only
import { inspectionWorld, type Login } from "./inspectionFixture";

const PW = ["In", "spect", "7x!"].join("-"); // inspectionFixture's made-up password

// main 694d2d82's allow-list (server/verificationSignatures.ts SIGNING_PATHS), frozen here to show the gap it left.
const MAIN_SIGNING_PATHS = [
  /^\/api\/(labs\/\d+\/)?studies\/\d+\/finalize$/,
  /^\/api\/labs\/\d+\/veritacheck\/signoff-groups\/\d+\/sign$/,
  /^\/api\/veritacheck\/verifications\/\d+\/(sign|plan\/sign|analytes\/\d+\/finalize)$/,
];
const mainLetsThrough = (method: string, path: string) => String(method).toUpperCase() === "POST" && MAIN_SIGNING_PATHS.some((re) => re.test(path));

async function main() {
  const w = await inspectionWorld("dsvo");
  const { sqlite, app, base, call, check, seed, member, seat, login, one, all, finish, A, B, X, OWNER, OTHER, VIEWER, SUPPORT, ADMIN, now } = w;
  const { isQualifiedSigningRequest, QUALIFIED_SIGNING_ROUTES } = await import("../../server/qualifiedSigning");
  const L = `/api/labs/${A}`;
  const lastMonth = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [py, pm] = lastMonth.split("-").map(Number);

  // ── People ──────────────────────────────────────────────────────────────────
  const viewOnly = (lab: number, u: Login, ownerId = OWNER.id) => { member(lab, u); seat(ownerId, u, lab, { type: "view_only", perms: { mode: "view_all" } }); };
  const MD = await login("director", "Dana Director"); viewOnly(A, MD);
  sqlite.prepare("UPDATE labs SET medical_director_email = ?, medical_director_name = 'Dana Director' WHERE id = ?").run(MD.email, A);
  const letter = (u: Login, position: string, duties: Record<string, boolean>, lab = A) => seed("director_delegations", {
    lab_id: lab, delegate_user_id: u.id, delegate_name: u.name, position, complexity_scope: "moderate", responsibilities_json: JSON.stringify(duties),
    signed_by_user_id: MD.id, signed_name: "Dana Director", signed_at: now, status: "active", created_at: now, updated_at: now,
  });
  const TC = await login("tc", "Casey Consultant"); viewOnly(A, TC); letter(TC, "technical_consultant", { qc_period_cosign: true });
  // Lab X's own director, on a view-only seat there; and the director of A, also on a view-only seat in sister lab B, which
  // directs itself (no director of B is named, so A's director is no one there).
  const XMD = await login("xdirector", "Xan Xdirector"); viewOnly(X, XMD, OTHER.id);
  sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(XMD.email, X);
  viewOnly(B, MD);
  const seatOf = (u: Login, lab: number) => one("SELECT seat_type FROM user_seats WHERE seat_user_id = ? AND lab_id = ?", u.id, lab)?.seat_type;
  check("0. setup: the director, the designee and the plain reviewer each hold a view-only seat in lab A", [MD, TC, VIEWER].every((u) => seatOf(u, A) === "view_only") && seatOf(MD, B) === "view_only" && seatOf(XMD, X) === "view_only");

  // A made-up VeritaMap in lab A: glucose is moderate complexity (a Technical Consultant covers it), on one analyzer.
  const mapId = Number((await call(OWNER, "POST", `${L}/veritamap/maps`, { name: "Made-up map" }, A)).j?.id);
  await fetch(`${base}/api/admin/veritamap/seed-map?secret=${ADMIN}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mapId, defaultActive: 1, instruments: [{ name: "Made-up CH-500", category: "Chemistry", tests: [{ analyte: "Glucose", specialty: "Chemistry", complexity: "MODERATE", active: 1 }] }] }),
  });
  const CHEM = Number(one("SELECT i.id FROM veritamap_instruments i WHERE i.map_id = ? AND i.instrument_name = 'Made-up CH-500'", mapId)?.id);
  check("0. setup: the analyzer and its moderate test are on lab A's map", CHEM > 0 && !!one("SELECT 1 AS x FROM veritamap_tests WHERE map_id = ? AND analyte = 'Glucose' AND complexity = 'MODERATE'", mapId));

  // ── 1. The QC co-sign ───────────────────────────────────────────────────────
  sqlite.prepare("UPDATE labs SET qc_md_cosign_required = 1 WHERE id IN (?, ?)").run(A, B);
  const lot = (lab: number, n: string) => seed("qc_control_lots", { lab_id: lab, analyte: "Glucose", level: "mid", lot_number: n, mfr_mean: 100, mfr_sd: 2 });
  const filed = (lab: number, lotId: number) => seed("qc_period_reviews", {
    lab_id: lab, control_lot_id: lotId, period_month: pm, period_year: py, reviewed_by_user_id: OWNER.id, reviewed_at: now, attestation_acknowledged: 1, created_at: now,
  });
  const lot1 = lot(A, "MU-101"), lot2 = lot(A, "MU-102"), lot3 = lot(A, "MU-103"), lotB = lot(B, "MU-201"), lotX = lot(X, "MU-301");
  const r1 = filed(A, lot1), r2 = filed(A, lot2), r3 = filed(A, lot3), rB = filed(B, lotB), rX = filed(X, lotX);
  const review = (id: number) => one("SELECT md_signed_at, md_signed_by_user_id, md_signed_name FROM qc_period_reviews WHERE id = ?", id);
  const cosignPath = (lab: number) => `/api/labs/${lab}/qc/period-reviews/md-cosign`;
  // BUG-205: the co-sign is signed with the typed name and the signer's own password (tests/integration/cosign-signature-check.test.ts).
  const cosign = (u: Login, lab: number, lotId: number, path = cosignPath(lab)) => call(u, "POST", path, { control_lot_id: lotId, period_year: py, period_month: pm, typed_name: u.name, password: PW }, lab);

  // The old gap: the screen said the director may co-sign, and main's gate refused the request before the route's check ran.
  const screen = (await call(MD, "GET", `${L}/qc/period-reviews?control_lot_id=${lot1}`, undefined, A)).j;
  check("1a. the old gap: the screen tells the view-only director they co-sign as the medical director", screen?.cosignAs === "medical_director" && screen?.mdCosignRequired === true, JSON.stringify(screen));
  check("1a. the old gap: main 694d2d82's allow-list doesn't name the co-sign, so its gate answered view_only_seat; the allow-list now does",
    !mainLetsThrough("POST", cosignPath(A)) && isQualifiedSigningRequest("POST", cosignPath(A)));

  const mdSign = await cosign(MD, A, lot1);
  const s1 = review(r1);
  check("1b. the medical director on a view-only seat co-signs the filed review", mdSign.s === 200 && mdSign.j?.signed_as === "medical_director" && !!s1?.md_signed_at && s1.md_signed_by_user_id === MD.id && s1.md_signed_name === "Dana Director", `${mdSign.s} ${mdSign.text} ${JSON.stringify(s1)}`);
  const tcSign = await cosign(TC, A, lot2);
  const s2 = review(r2);
  check("1c. a designee holding the qc_period_cosign duty, on a view-only seat, co-signs too", tcSign.s === 200 && tcSign.j?.signed_as === "designee" && !!s2?.md_signed_at && s2.md_signed_by_user_id === TC.id && s2.md_signed_name === "Casey Consultant (designee)", `${tcSign.s} ${tcSign.text}`);
  const viewerSign = await cosign(VIEWER, A, lot3);
  check("1d. a view-only seat with no director role or duty gets the route's own 403, not a co-signature", viewerSign.s === 403 && viewerSign.j?.error !== "view_only_seat" && /Only the medical director/.test(viewerSign.j?.error || "") && !review(r3)?.md_signed_at, `${viewerSign.s} ${viewerSign.text}`);
  const ownerSign = await cosign(OWNER, A, lot3);
  check("1e. the owner override is as it was", ownerSign.s === 200 && ownerSign.j?.signed_as === "owner_override" && /\(owner override\)$/.test(review(r3)?.md_signed_name || ""), `${ownerSign.s} ${ownerSign.text}`);

  // ── 2. Every other write stays refused for the same view-only director ─────
  const refusedAsViewOnly = (r: { s: number; j: any }) => r.s === 403 && r.j?.error === "view_only_seat";
  const fileReview = await call(MD, "POST", `${L}/qc/period-reviews`, { control_lot_id: lot1, period_year: py, period_month: pm, attestation_acknowledged: true }, A);
  check("2a. filing the monthly review is still refused: view_only_seat", refusedAsViewOnly(fileReview), `${fileReview.s} ${fileReview.text}`);
  const setting = await call(MD, "POST", `${L}/qc/md-cosign-setting`, { required: false }, A);
  check("2b. the co-sign setting is still refused, and stays on", refusedAsViewOnly(setting) && one("SELECT qc_md_cosign_required AS v FROM labs WHERE id = ?", A).v === 1, `${setting.s} ${setting.text}`);
  const rules = await call(MD, "PUT", `${L}/qc/rule-settings`, { rules: {}, reason: "made-up" }, A);
  const lock = await call(MD, "POST", `${L}/qc/rule-settings/lock`, { locked: true }, A);
  check("2c. the QC rules and their lock (edits, not a signature on a record) are still refused", refusedAsViewOnly(rules) && refusedAsViewOnly(lock), `${rules.s} ${lock.s}`);
  const scan = await call(MD, "POST", `${L}/veritascan/scans`, { name: "Made-up scan" }, A);
  check("2d. an ordinary write in another module (a new VeritaScan) is still refused", refusedAsViewOnly(scan) && !one("SELECT 1 AS x FROM veritascan_scans WHERE name = 'Made-up scan'"), `${scan.s} ${scan.text}`);
  const r4 = filed(A, lot(A, "MU-104"));
  const lot4 = Number(one("SELECT control_lot_id AS l FROM qc_period_reviews WHERE id = ?", r4).l);
  const slash = await cosign(MD, A, lot4, `${cosignPath(A)}/`);
  const upper = await cosign(MD, A, lot4, `/api/labs/${A}/QC/period-reviews/md-cosign`);
  check("2e. a path Express would also route to the co-sign, but isn't its exact path, is refused at the gate", refusedAsViewOnly(slash) && refusedAsViewOnly(upper) && !review(r4)?.md_signed_at, `${slash.s} ${upper.s}`);

  // ── 3. Another lab's director, a sister lab, Veritas support ──────────────
  const xIntoA = await cosign(XMD, A, lot4);
  check("3a. another customer's director can't co-sign lab A's review", [403, 404].includes(xIntoA.s) && !review(r4)?.md_signed_at, `${xIntoA.s} ${xIntoA.text}`);
  const xOwn = await cosign(XMD, X, lotX);
  check("3a. and co-signs in their own lab from their view-only seat (decided in the record's own lab)", xOwn.s === 200 && review(rX)?.md_signed_by_user_id === XMD.id, `${xOwn.s} ${xOwn.text}`);
  const inB = await cosign(MD, B, lotB);
  check("3b. lab A's director, on a view-only seat in sister lab B, isn't B's director: the route refuses", inB.s === 403 && inB.j?.error !== "view_only_seat" && !review(rB)?.md_signed_at, `${inB.s} ${inB.text}`);
  const sup = await cosign(SUPPORT, A, lot4);
  check("3c. Veritas support can't co-sign", sup.s === 403 && sup.j?.code === "VLS_SUPPORT_CANNOT_SIGN" && !review(r4)?.md_signed_at, `${sup.s} ${sup.text}`);

  // ── 4. The other signatures on the list ───────────────────────────────────
  // 4a. A finding's sign-off (mayAttestAsDirectorOrDesignee, finding_closure).
  const finding = () => seed("findings", { user_id: OWNER.id, lab_id: A, accreditor: "CAP", status: "open", created_at: now, updated_at: now });
  const f1 = finding(), f2 = finding();
  const F = (id: number) => one("SELECT status, signed_by, signoff_role FROM findings WHERE id = ?", id);
  const fPath = (id: number) => `${L}/findings/${id}/signoff`;
  check("4a. the old gap: main's gate refused a finding's sign-off from a view-only seat", !mainLetsThrough("POST", fPath(f1)) && isQualifiedSigningRequest("POST", fPath(f1)));
  const fHist = (await call(MD, "GET", `${L}/findings/${f1}/history`, undefined, A)).j;
  const fSign = await call(MD, "POST", fPath(f1), { signed_by: MD.name, password: PW }, A);
  check("4a. the view-only director signs off and closes a finding", fHist?.signoffAs === "medical_director" && fSign.s === 200 && F(f1).status === "closed" && F(f1).signoff_role === "medical_director" && F(f1).signed_by === "Dana Director", `${fSign.s} ${fSign.text.slice(0, 200)}`);
  const fViewer = await call(VIEWER, "POST", fPath(f2), {}, A);
  check("4a. a view-only seat with no director role or duty gets the route's 403", fViewer.s === 403 && fViewer.j?.error !== "view_only_seat" && F(f2).status === "open", `${fViewer.s} ${fViewer.text}`);
  const fEdit = await call(MD, "PUT", `${L}/findings/${f2}`, { status: "closed" }, A);
  check("4a. editing a finding is still refused", refusedAsViewOnly(fEdit) && F(f2).status === "open", `${fEdit.s} ${fEdit.text}`);

  // 4b. The VeritaMaintain monthly review (recordReviewCapacity, equipment_record_review).
  // In service since before last month, so last month's review lists it.
  const eq = seed("lab_equipment", { lab_id: A, instrument_name: "Made-up Centrifuge", status: "active", created_at: "2025-01-01T00:00:00.000Z", updated_at: now });
  const mrPath = `${L}/maintain-reviews`;
  check("4b. the old gap: main's gate refused the monthly record review from a view-only seat", !mainLetsThrough("POST", mrPath) && isQualifiedSigningRequest("POST", mrPath));
  const month = (await call(MD, "GET", `${mrPath}?month=${lastMonth}`, undefined, A)).j;
  const item = (month?.items || []).find((i: any) => i.type === "equipment" && i.id === eq) || (month?.items || []).find((i: any) => i.id === eq);
  const mrBody = (u: Login) => ({ month: lastMonth, items: [{ type: item?.type, id: eq }], typed_signature: u.name, password: PW, corrective_action: item?.problems?.length ? "Made-up corrective action recorded" : undefined });
  const mrViewer = await call(VIEWER, "POST", mrPath, mrBody(VIEWER), A);
  check("4b. a view-only seat with no director role or duty gets the route's 403", mrViewer.s === 403 && mrViewer.j?.code === "NOT_DIRECTOR_OR_DESIGNEE", `${mrViewer.s} ${mrViewer.text}`);
  const mrSign = await call(MD, "POST", mrPath, mrBody(MD), A);
  const mrRow = one("SELECT reviewed_by_user_id, capacity, signed_with FROM maintain_record_reviews WHERE lab_id = ? AND period = ? AND item_id = ?", A, lastMonth, eq);
  check("4b. the view-only director signs the month's review with their password", month?.can_review === true && !!item && mrSign.s === 201 && mrRow?.reviewed_by_user_id === MD.id && mrRow?.capacity === "medical_director" && mrRow?.signed_with === "password", `${mrSign.s} ${mrSign.text} ${JSON.stringify(item)}`);

  // 4c. VeritaComp: the observer and the evaluator each sign as their own VeritaStaff row in the lab (B5).
  const person = async (last: string, first: string, roles: any[] = []) =>
    Number((await call(OWNER, "POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "H", performsTesting: true, hireDate: "2019-03-01", roles }, A)).j?.id);
  const pat = await person("Person", "Pat");
  const dana = await person("Director", "Dana", [{ role: "LD" }]);
  sqlite.prepare("UPDATE staff_employees SET login_user_id = ? WHERE id = ?").run(MD.id, dana);
  sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(pat, CHEM, now);
  const day = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10), observed = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
  const entries = [
    { num: 1, specimenId: "QA-1042", observerInitials: "DD", dateObserved: "", passed: true },
    { num: 2, evidence: "Result review", date: day, passed: true },
    { num: 3, qcDate: day, passed: true },
    { num: 4, dateObserved: day, observerInitials: "DD", passed: true },
    { num: 5, samples: [{ sampleType: "PT", sampleId: "PT-1", acceptable: true }], passed: true },
    { num: 6, quizId: "Q-1", score: 100, dateTaken: day, passed: true },
  ];
  const saved = await call(OWNER, "PUT", `${L}/competency/employee/${pat}/test-system/${CHEM}`, { elements: entries }, A);
  const obsPath = `${L}/competency/observations/sign`, methodPath = `${L}/competency/employee/${pat}/test-system/${CHEM}/sign`;
  check("4c. setup: Pat's method is entered naming the director (DD) as observer; the director's sign-in is linked to an LD roster row", pat > 0 && dana > 0 && saved.s === 200, `${pat} ${dana} ${saved.s} ${saved.text.slice(0, 200)}`);
  check("4c. the old gap: main's gate refused both competency signatures from a view-only seat", !mainLetsThrough("POST", obsPath) && !mainLetsThrough("POST", methodPath) && isQualifiedSigningRequest("POST", obsPath) && isQualifiedSigningRequest("POST", methodPath));
  const toSign = (await call(MD, "GET", `${L}/competency/to-sign`, undefined, A)).j;
  const obsItems = (toSign?.observations || []).filter((o: any) => o.employeeId === pat && o.instrumentId === CHEM).map((o: any) => ({ itemId: o.itemId, dateObserved: observed, result: "pass" }));
  const obsViewer = await call(VIEWER, "POST", obsPath, { typedName: VIEWER.name, password: PW, items: obsItems }, A);
  check("4c. a view-only seat that isn't on the roster gets the route's 403 for an observation", obsViewer.s === 403 && obsViewer.j?.code === "NOT_ON_ROSTER", `${obsViewer.s} ${obsViewer.text}`);
  const obsSign = await call(MD, "POST", obsPath, { typedName: MD.name, password: PW, items: obsItems }, A);
  const obsRows = all("SELECT observer_staff_employee_id, signed_by_user_id, result FROM competency_observation_signatures WHERE staff_employee_id = ? AND instrument_id = ?", pat, CHEM);
  check("4c. the view-only director signs as the observer on Elements 1 and 4", obsItems.length === 2 && obsSign.s === 200 && obsSign.j?.signed === 2 && obsRows.length === 2 && obsRows.every((r) => r.observer_staff_employee_id === dana && r.signed_by_user_id === MD.id && r.result === "pass"), `${obsItems.length} ${obsSign.s} ${obsSign.text}`);
  const paper = await call(MD, "POST", methodPath, { fromPaper: true, paperLocation: "Binder C-4", signerIsMedicalDirector: true, determination: "pass" }, A);
  check("4c. entering a sign-off from paper changes the record, so it still needs edit: refused", paper.s === 403 && paper.j?.code === "PAPER_NEEDS_EDIT", `${paper.s} ${paper.text}`);
  const methodViewer = await call(VIEWER, "POST", methodPath, { typedName: VIEWER.name, password: PW, determination: "pass" }, A);
  check("4c. a view-only seat that isn't on the roster gets the route's 403 for a method", methodViewer.s === 403 && methodViewer.j?.code === "NOT_ON_ROSTER", `${methodViewer.s} ${methodViewer.text}`);
  const methodSign = await call(MD, "POST", methodPath, { typedName: MD.name, password: PW, determination: "pass" }, A);
  const so = one("SELECT signer_staff_employee_id, signed_by_user_id, determination, signed_with FROM competency_method_signoffs WHERE staff_employee_id = ? AND instrument_id = ?", pat, CHEM);
  check("4c. the view-only director signs Pat's method as the laboratory director", methodSign.s === 200 && so?.signer_staff_employee_id === dana && so?.signed_by_user_id === MD.id && so?.determination === "pass" && so?.signed_with === "password", `${methodSign.s} ${methodSign.text}`);
  const compEdit = await call(MD, "PUT", `${L}/competency/employee/${pat}/test-system/${CHEM}`, { elements: entries }, A);
  check("4c. saving competency entries is still refused", refusedAsViewOnly(compEdit), `${compEdit.s} ${compEdit.text}`);

  // ── 5. BUG-188 read-and-sign: the Staff session has no view-only gate ─────
  const staffSign = await call(MD, "POST", "/api/staff-portal-session/policies/sign-several", { items: [] }, A);
  check("5. the view-only director reaches read-and-sign through their roster link and gets the route's own answer, not view_only_seat",
    staffSign.s === 400 && staffSign.j?.code === "NO_ITEMS", `${staffSign.s} ${staffSign.text}`);

  // ── 6. The allow-list reaches exactly the routes it names ─────────────────
  const stack: any[] = (app as any)._router?.stack ?? (app as any).router?.stack ?? [];
  const posts = new Set<string>();
  const reached = new Set<string>();
  const otherMethods: string[] = [];
  for (const layer of stack) {
    const route = layer.route;
    if (!route || typeof route.path !== "string") continue;
    const sample = route.path.replace(/:[A-Za-z]+/g, "7");
    for (const m of Object.keys(route.methods)) {
      if (m === "post") { posts.add(route.path); if (isQualifiedSigningRequest("POST", sample)) reached.add(route.path); }
      else if (isQualifiedSigningRequest(m, sample)) otherMethods.push(`${m} ${route.path}`);
    }
  }
  const named = [...QUALIFIED_SIGNING_ROUTES].sort();
  check("6a. every route on the list is a POST route the server has", named.every((r) => posts.has(r)), named.filter((r) => !posts.has(r)).join(", "));
  check("6b. the list reaches no POST route it doesn't name", [...reached].sort().join("|") === named.join("|"), [...reached].filter((r) => !named.includes(r as any)).join(", "));
  check("6c. no other method passes, and ids must be digits", otherMethods.length === 0 && ["PUT", "PATCH", "DELETE", "GET"].every((m) => !isQualifiedSigningRequest(m, cosignPath(A)))
    && !isQualifiedSigningRequest("POST", "/api/labs/abc/qc/period-reviews/md-cosign") && !isQualifiedSigningRequest("POST", `/api/labs/${A}/findings/1x/signoff`)
    && !isQualifiedSigningRequest("POST", `/api/labs/${A}/qc/period-reviews`) && !isQualifiedSigningRequest("POST", `/api/labs/${A}/maintain-reviews/report.xlsx`), otherMethods.join(", "));
  check("6d. main's VeritaCheck signatures are all still on the list", ["/api/labs/1/studies/2/finalize", "/api/studies/2/finalize", "/api/labs/1/veritacheck/signoff-groups/2/sign", "/api/veritacheck/verifications/2/sign", "/api/veritacheck/verifications/2/plan/sign", "/api/veritacheck/verifications/2/analytes/3/finalize"].every((p) => mainLetsThrough("POST", p) && isQualifiedSigningRequest("POST", p)));
  finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
