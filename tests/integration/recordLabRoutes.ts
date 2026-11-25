// tests/integration/recordLabRoutes.ts
//
// The by-id changes record-lab-edit.test.ts drives, one entry each: how to make a record in a lab, the request, and what shows
// whether the record changed. Not a test by itself.

export interface MadeRecord { path: string; body?: unknown; file?: boolean; snap: () => string }
export interface RecordRoute {
  name: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  module: string;
  make: (lab: number, ownerId: number) => MadeRecord;
  /** The route also wants the record's stored owner to be the account the person works under, so someone with no seat there is refused as before. */
  ownRows?: boolean;
  /** Only the person who made the record passes the route's own test. */
  ownOnly?: boolean;
  /** The route has its own edit rule for the record's lab, which an older seat doesn't pass. */
  ownEditRule?: boolean;
  /** The older assessment routes refuse an account that owns several labs. */
  oneLabOnly?: boolean;
}

export interface RouteWorld {
  seed: (table: string, values: Record<string, any>) => number;
  one: (q: string, ...a: any[]) => any;
  now: string;
  stamp: number;
}

export function recordRoutes(w: RouteWorld): RecordRoute[] {
  const { seed, one, now } = w;
  let n = 0;
  const tag = () => `${w.stamp}-${++n}`;
  const row = (table: string, id: number) => () => JSON.stringify(one(`SELECT * FROM ${table} WHERE id = ?`, id) ?? null);
  const count = (table: string, col: string, id: number) => () => String(one(`SELECT COUNT(*) AS n FROM ${table} WHERE ${col} = ?`, id).n);

  const study = (lab: number, owner: number, more: Record<string, any> = {}) => seed("studies", {
    user_id: owner, lab_id: lab, test_name: `Study ${tag()}`, instrument: "x", analyst: "x", date: "2026-10-15", study_type: "precision",
    clia_allowable_error: 0.1, data_points: JSON.stringify([{ level: 1, values: [1, 1.01] }, { level: 2, values: [2, 2.01] }]), instruments: '["x"]', status: "draft", created_at: now, ...more,
  });
  const map = (lab: number, owner: number) => seed("veritamap_maps", { user_id: owner, lab_id: lab, name: `Map ${tag()}`, instruments: "[]" });
  const instrument = (mapId: number) => {
    const id = seed("veritamap_instruments", { map_id: mapId, instrument_name: `Analyzer ${tag()}`, role: "Primary", category: "Chemistry" });
    seed("veritamap_instrument_tests", { instrument_id: id, map_id: mapId, analyte: "Glucose", specialty: "Chemistry", complexity: "MODERATE", active: 1 });
    return id;
  };
  const mapTest = (mapId: number) => seed("veritamap_tests", { map_id: mapId, analyte: "Glucose", specialty: "Chemistry", complexity: "MODERATE", active: 1, updated_at: now });
  const scan = (lab: number, owner: number) => seed("veritascan_scans", { user_id: owner, lab_id: lab, name: `Scan ${tag()}` });
  const tracker = (lab: number, owner: number) => seed("cumsum_trackers", { user_id: owner, lab_id: lab, instrument_name: `Coag ${tag()}`, analyte: "PTT" });
  const finding = (lab: number, owner: number) => seed("findings", { user_id: owner, lab_id: lab, accreditor: "CMS", standard_ref: "42 CFR 493.1253", finding_number: tag(), status: "open" });
  const program = (lab: number, owner: number, type = "nontechnical") => seed("competency_programs", { user_id: owner, lab_id: lab, name: `Program ${tag()}`, department: "Chemistry", type });
  const employee = (lab: number, owner: number) => seed("competency_employees", { user_id: owner, lab_id: lab, name: `Made Up Tech ${tag()}`, status: "active" });
  const assessment = (lab: number, owner: number) => seed("competency_assessments", {
    program_id: program(lab, owner), employee_id: employee(lab, owner), assessment_date: "2026-10-15", evaluator_name: "Made Up Evaluator", status: "fail", assessment_type: "annual", competency_type: "nontechnical", created_at: now,
  });
  const QUESTIONS = [{ id: "q1", question: "Which?", options: ["a", "b"], correct_answer: "a" }];
  const quiz = (lab: number, owner: number) => seed("competency_quizzes", { user_id: owner, lab_id: lab, program_id: program(lab, owner), title: `Quiz ${tag()}`, questions: JSON.stringify(QUESTIONS), created_at: now });
  const staffLab = (lab: number, owner: number) => Number(one("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", lab)?.id ?? seed("staff_labs", { user_id: owner, tier2_lab_id: lab, lab_name: "Made-up Lab", clia_number: "22D0000777" }));
  const person = (lab: number, owner: number) => seed("staff_employees", { user_id: owner, lab_id: staffLab(lab, owner), tier2_lab_id: lab, first_name: "Made", last_name: `Up ${tag()}`, status: "active" });
  const assignment = (lab: number, owner: number, quizId: number, more: Record<string, any> = {}) => seed("competency_quiz_assignments", { quiz_id: quizId, staff_employee_id: person(lab, owner), lab_id: lab, assigned_by_user_id: owner, assigned_at: now, status: "assigned", attempt_no: 1, ...more });
  const failedAttempt = (lab: number, owner: number) => {
    const quizId = quiz(lab, owner), who = person(lab, owner);
    const result = seed("competency_quiz_results", { quiz_id: quizId, employee_id: employee(lab, owner), staff_employee_id: who, answers: "[]", score: 10, passed: 0, date_taken: "2026-10-15", created_at: now, source: "staff_portal" });
    seed("competency_quiz_assignments", { quiz_id: quizId, staff_employee_id: who, lab_id: lab, assigned_by_user_id: owner, assigned_at: now, status: "completed", attempt_no: 1, completed_result_id: result, completed_at: now });
    return { quizId, who, result };
  };
  const cert = (lab: number, owner: number) => seed("lab_certificates", { user_id: owner, lab_id: lab, cert_type: "other", cert_name: `Certificate ${tag()}`, is_active: 1 });
  const policy = (lab: number, owner: number) => seed("veritapolicy_lab_policies", { user_id: owner, lab_id: lab, policy_name: `Policy ${tag()}` });
  const staffing = (lab: number, owner: number) => seed("staffing_studies", { account_id: owner, lab_id: lab, name: `Staffing ${tag()}` });
  const item = (lab: number, owner: number) => seed("inventory_items", { account_id: owner, lab_id: lab, item_name: `Item ${tag()}`, lead_time_days: 5 });
  const cost = (lab: number, owner: number) => seed("veritaops_test_cost_studies", { account_id: owner, lab_id: lab, test_name: `Cost ${tag()}` });
  const task = (lab: number, owner: number) => seed("veritatrack_tasks", { user_id: owner, lab_id: lab, name: `Task ${tag()}`, category: "Other", frequency: "Monthly", frequency_months: 1, active: 1, created_at: now, updated_at: now });
  const signoff = (lab: number, owner: number) => seed("veritatrack_signoffs", { task_id: task(lab, owner), user_id: owner, lab_id: lab, completed_date: "2026-10-01" });
  const verification = (lab: number, owner: number) => seed("veritacheck_verifications", { user_id: owner, lab_id: lab, instrument_name: `Verification ${tag()}`, trigger_type: "new_instrument", elements: "[]" });
  const unit = (v: number) => seed("veritacheck_verification_instruments", { verification_id: v, serial_number: tag() });
  const analyte = (v: number, more: Record<string, any> = {}) => seed("veritacheck_verification_analytes", { verification_id: v, analyte_name: `Analyte ${tag()}`, created_at: now, updated_at: now, ...more });

  const out: RecordRoute[] = [];
  const add = (method: RecordRoute["method"], name: string, module: string, make: RecordRoute["make"], more: Partial<RecordRoute> = {}) => out.push({ method, name, module, make, ...more });

  // VeritaCheck
  const studyCall = (suffix: string, body: unknown, extra: Record<string, any> = {}): RecordRoute["make"] => (lab, owner) => { const id = study(lab, owner, extra); return { path: `/api/studies/${id}${suffix}`, body, snap: row("studies", id) }; };
  add("PUT", "study", "veritacheck", studyCall("", { status: "draft", testName: "Changed", studyType: "precision" }));
  add("DELETE", "study", "veritacheck", studyCall("", undefined), { ownRows: true });
  add("POST", "study point exclude", "veritacheck", studyCall("/points/0/exclude", { reason: "made up" }));
  add("POST", "study point include", "veritacheck", studyCall("/points/0/include", {}));
  add("POST", "study range", "veritacheck", studyCall("/amr", { amr_low: 1, amr_high: 9, amr_units: "mg/dL" }));
  add("POST", "study censoring", "veritacheck", studyCall("/censoring-policy", { policy: "substitute_lld" }));
  add("POST", "study sign", "veritacheck", studyCall("/finalize", { signature: "Made Up" }));
  add("POST", "study amend", "veritacheck", (lab, owner) => { const id = study(lab, owner, { lifecycle_state: "finalized", status: "pass" }); return { path: `/api/studies/${id}/amend`, body: {}, snap: count("studies", "amends_study_id", id) }; });
  add("POST", "study archive", "veritacheck", studyCall("/archive", { reason: "made up" }));
  add("POST", "study unarchive", "veritacheck", studyCall("/unarchive", {}, { archived_at: now, archive_reason: "made up" }));
  add("DELETE", "lot tracker", "veritacheck", (lab, owner) => { const id = tracker(lab, owner); return { path: `/api/veritacheck/cumsum/trackers/${id}`, snap: row("cumsum_trackers", id) }; });
  add("POST", "lot tracker entry", "veritacheck", (lab, owner) => { const id = tracker(lab, owner); return { path: `/api/veritacheck/cumsum/trackers/${id}/entries`, body: { year: 2026, lotLabel: "L" }, snap: count("cumsum_entries", "tracker_id", id) }; });
  add("DELETE", "lot tracker entry", "veritacheck", (lab, owner) => { const id = seed("cumsum_entries", { tracker_id: tracker(lab, owner), year: 2026, lot_label: "L" }); return { path: `/api/veritacheck/cumsum/entries/${id}`, snap: row("cumsum_entries", id) }; }, { ownOnly: true });
  const verif = (make: (v: number, lab: number, owner: number) => MadeRecord): RecordRoute["make"] => (lab, owner) => make(verification(lab, owner), lab, owner);
  const vBase = "/api/veritacheck/verifications";
  add("PATCH", "verification", "veritacheck", verif((v) => ({ path: `${vBase}/${v}`, body: { status: "in_progress", remediation_notes: "changed" }, snap: row("veritacheck_verifications", v) })));
  add("DELETE", "verification", "veritacheck", verif((v) => ({ path: `${vBase}/${v}`, snap: row("veritacheck_verifications", v) })));
  add("POST", "verification unit", "veritacheck", verif((v) => ({ path: `${vBase}/${v}/instruments`, body: { serial_number: "1" }, snap: count("veritacheck_verification_instruments", "verification_id", v) })));
  add("PATCH", "verification unit", "veritacheck", verif((v) => { const id = unit(v); return { path: `${vBase}/${v}/instruments/${id}`, body: { model: "changed" }, snap: row("veritacheck_verification_instruments", id) }; }));
  add("DELETE", "verification unit", "veritacheck", verif((v) => { const id = unit(v); return { path: `${vBase}/${v}/instruments/${id}`, snap: row("veritacheck_verification_instruments", id) }; }));
  add("POST", "verification analyte", "veritacheck", verif((v) => ({ path: `${vBase}/${v}/analytes`, body: { analyte_name: "Sodium" }, snap: count("veritacheck_verification_analytes", "verification_id", v) })));
  add("PATCH", "verification analyte", "veritacheck", verif((v) => { const id = analyte(v); return { path: `${vBase}/${v}/analytes/${id}`, body: { tea_units: "changed" }, snap: row("veritacheck_verification_analytes", id) }; }));
  add("POST", "verification analyte sign", "veritacheck", verif((v) => { const id = analyte(v); return { path: `${vBase}/${v}/analytes/${id}/finalize`, body: { signature: "Made Up" }, snap: row("veritacheck_verification_analytes", id) }; }));
  add("DELETE", "verification analyte", "veritacheck", verif((v) => { analyte(v); const id = analyte(v); return { path: `${vBase}/${v}/analytes/${id}`, snap: row("veritacheck_verification_analytes", id) }; }));
  add("POST", "verification analyte amend", "veritacheck", verif((v) => { const id = analyte(v, { lifecycle_state: "finalized" }); return { path: `${vBase}/${v}/analytes/${id}/amend`, body: {}, snap: count("veritacheck_verification_analytes", "amends_analyte_id", id) }; }));
  add("PATCH", "verification study slot", "veritacheck", verif((v) => { const id = seed("veritacheck_verification_studies", { verification_id: v, element: "accuracy" }); return { path: `${vBase}/${v}/studies/${id}`, body: { result_summary: "changed" }, snap: row("veritacheck_verification_studies", id) }; }));

  // VeritaMap
  const onMap = (make: (id: number) => MadeRecord): RecordRoute["make"] => (lab, owner) => make(map(lab, owner));
  const mBase = "/api/veritamap/maps";
  add("DELETE", "map", "veritamap", onMap((id) => ({ path: `${mBase}/${id}`, snap: row("veritamap_maps", id) })));
  add("PUT", "map tests", "veritamap", onMap((id) => ({ path: `${mBase}/${id}/tests`, body: { tests: [{ analyte: "Sodium", specialty: "Chemistry", complexity: "MODERATE", active: true }] }, snap: count("veritamap_tests", "map_id", id) })));
  add("POST", "map instrument", "veritamap", onMap((id) => ({ path: `${mBase}/${id}/instruments`, body: { instrument_name: "Analyzer" }, snap: count("veritamap_instruments", "map_id", id) })));
  add("PUT", "map instrument", "veritamap", onMap((id) => { const i = instrument(id); return { path: `${mBase}/${id}/instruments/${i}`, body: { instrument_name: "Changed", role: "Backup", category: "Chemistry" }, snap: row("veritamap_instruments", i) }; }));
  add("DELETE", "map instrument", "veritamap", onMap((id) => { const i = instrument(id); return { path: `${mBase}/${id}/instruments/${i}`, snap: row("veritamap_instruments", i) }; }));
  add("POST", "map instrument copy", "veritamap", onMap((id) => { const from = instrument(id), to = seed("veritamap_instruments", { map_id: id, instrument_name: `Analyzer ${tag()}` }); return { path: `${mBase}/${id}/instruments/${to}/copy-from/${from}`, body: {}, snap: count("veritamap_instrument_tests", "instrument_id", to) }; }));
  add("PUT", "map instrument tests", "veritamap", onMap((id) => { const i = instrument(id); return { path: `${mBase}/${id}/instruments/${i}/tests`, body: { tests: [{ analyte: "Sodium", specialty: "Chemistry", complexity: "MODERATE", active: 1 }, { analyte: "Potassium", specialty: "Chemistry", complexity: "MODERATE", active: 1 }] }, snap: count("veritamap_instrument_tests", "instrument_id", i) }; }));
  add("PUT", "map test", "veritamap", onMap((id) => { const t = mapTest(id); return { path: `${mBase}/${id}/tests/Glucose`, body: { notes: "changed" }, snap: row("veritamap_tests", t) }; }));
  add("PUT", "map analyte values", "veritamap", onMap((id) => ({ path: `${mBase}/${id}/analyte-values/Glucose`, body: { ref_range_low: "1", ref_range_high: "2" }, snap: count("veritamap_analyte_values", "map_id", id) })));
  add("PUT", "map range values", "veritamap", onMap((id) => { const i = instrument(id); return { path: `${mBase}/${id}/amr-values/${i}/Glucose`, body: { amr_low: "1", amr_high: "9" }, snap: count("veritamap_amr_values", "map_id", id) }; }));

  // VeritaScan
  add("DELETE", "scan", "veritascan", (lab, owner) => { const id = scan(lab, owner); return { path: `/api/veritascan/scans/${id}`, snap: row("veritascan_scans", id) }; });
  add("PUT", "scan item", "veritascan", (lab, owner) => { const id = scan(lab, owner); return { path: `/api/veritascan/scans/${id}/items/1`, body: { status: "Compliant" }, snap: () => JSON.stringify(one("SELECT status FROM veritascan_items WHERE scan_id = ? AND item_id = 1", id) ?? null) }; });
  add("PUT", "scan items", "veritascan", (lab, owner) => { const id = scan(lab, owner); return { path: `/api/veritascan/scans/${id}/items`, body: { items: [{ item_id: 1, status: "Compliant" }] }, snap: () => JSON.stringify(one("SELECT status FROM veritascan_items WHERE scan_id = ? AND item_id = 1", id) ?? null) }; });

  // VeritaResponse
  add("PUT", "finding", "veritaresponse", (lab, owner) => { const id = finding(lab, owner); return { path: `/api/findings/${id}`, body: { description: "changed" }, snap: row("findings", id) }; });
  add("DELETE", "finding", "veritaresponse", (lab, owner) => { const id = finding(lab, owner); return { path: `/api/findings/${id}`, snap: row("findings", id) }; });

  // VeritaComp
  add("DELETE", "program", "veritacomp", (lab, owner) => { const id = program(lab, owner); return { path: `/api/competency/programs/${id}`, snap: row("competency_programs", id) }; });
  add("PUT", "program", "veritacomp", (lab, owner) => { const id = program(lab, owner); return { path: `/api/competency/programs/${id}`, body: { name: "Changed" }, snap: row("competency_programs", id) }; });
  add("PUT", "competency employee", "veritacomp", (lab, owner) => { const id = employee(lab, owner); return { path: `/api/competency/employees/${id}`, body: { title: "changed" }, snap: row("competency_employees", id) }; });
  add("DELETE", "competency employee", "veritacomp", (lab, owner) => { const id = employee(lab, owner); return { path: `/api/competency/employees/${id}`, snap: row("competency_employees", id) }; });
  add("POST", "assessment", "veritacomp", (lab, owner) => { const p = program(lab, owner), e = employee(lab, owner); return { path: "/api/competency/assessments", body: { programId: p, employeeId: e, assessmentType: "annual", assessmentDate: "2026-10-15" }, snap: count("competency_assessments", "program_id", p) }; });
  add("PUT", "assessment", "veritacomp", (lab, owner) => { const id = assessment(lab, owner); return { path: `/api/competency/assessments/${id}`, body: { remediationPlan: "changed" }, snap: row("competency_assessments", id) }; }, { ownRows: true, oneLabOnly: true });
  add("DELETE", "assessment", "veritacomp", (lab, owner) => { const id = assessment(lab, owner); return { path: `/api/competency/assessments/${id}`, snap: row("competency_assessments", id) }; }, { ownRows: true, oneLabOnly: true });
  add("POST", "assessment sign", "veritacomp", (lab, owner) => { const id = assessment(lab, owner); return { path: `/api/competency/assessments/${id}/sign`, body: {}, snap: row("competency_assessments", id) }; }, { ownRows: true, oneLabOnly: true });
  add("POST", "quiz", "veritacomp", (lab, owner) => { const p = program(lab, owner); return { path: `/api/veritacomp/programs/${p}/quizzes`, body: { title: "New", questions: QUESTIONS }, snap: count("competency_quizzes", "program_id", p) }; });
  add("DELETE", "quiz", "veritacomp", (lab, owner) => { const id = quiz(lab, owner); return { path: `/api/veritacomp/quizzes/${id}`, snap: row("competency_quizzes", id) }; });
  add("PUT", "quiz", "veritacomp", (lab, owner) => { const id = quiz(lab, owner); return { path: `/api/veritacomp/quizzes/${id}`, body: { title: "Changed", questions: QUESTIONS }, snap: row("competency_quizzes", id) }; });
  add("POST", "quiz assign", "veritacomp", (lab, owner) => { const id = quiz(lab, owner), who = person(lab, owner); return { path: `/api/veritacomp/quizzes/${id}/assignments`, body: { staff_employee_ids: [who] }, snap: count("competency_quiz_assignments", "quiz_id", id) }; });
  add("POST", "quiz retake", "veritacomp", (lab, owner) => { const { quizId, who } = failedAttempt(lab, owner); return { path: `/api/veritacomp/quizzes/${quizId}/retake`, body: { staff_employee_id: who }, snap: count("competency_quiz_assignments", "quiz_id", quizId) }; }, { ownEditRule: true });
  add("POST", "quiz attempt void", "veritacomp", (lab, owner) => { const { result } = failedAttempt(lab, owner); return { path: `/api/veritacomp/quiz-results/${result}/void`, body: { reason: "made up" }, snap: row("competency_quiz_results", result) }; }, { ownEditRule: true });
  add("DELETE", "quiz assignment", "veritacomp", (lab, owner) => { const id = assignment(lab, owner, quiz(lab, owner)); return { path: `/api/veritacomp/quiz-assignments/${id}`, snap: row("competency_quiz_assignments", id) }; });
  add("POST", "quiz result", "veritacomp", (lab, owner) => { const q = quiz(lab, owner), e = employee(lab, owner); return { path: "/api/veritacomp/quiz-results", body: { quizId: q, employeeId: e, answers: [{ question_id: "q1", selected_answer: "a" }] }, snap: count("competency_quiz_results", "quiz_id", q) }; });

  // VeritaLab
  add("PUT", "certificate", "veritalab", (lab, owner) => { const id = cert(lab, owner); return { path: `/api/veritalab/certificates/${id}`, body: { notes: "changed" }, snap: row("lab_certificates", id) }; });
  add("DELETE", "certificate", "veritalab", (lab, owner) => { const id = cert(lab, owner); return { path: `/api/veritalab/certificates/${id}`, snap: row("lab_certificates", id) }; });
  add("POST", "certificate document", "veritalab", (lab, owner) => { const id = cert(lab, owner); return { path: `/api/veritalab/certificates/${id}/documents`, file: true, snap: count("lab_certificate_documents", "certificate_id", id) }; });
  add("DELETE", "certificate document", "veritalab", (lab, owner) => { const c = cert(lab, owner), id = seed("lab_certificate_documents", { certificate_id: c, user_id: owner, lab_id: lab, filename: "a.txt", original_filename: "a.txt" }); return { path: `/api/veritalab/certificates/${c}/documents/${id}`, snap: row("lab_certificate_documents", id) }; });

  // VeritaDC
  add("PUT", "policy", "veritapolicy", (lab, owner) => { const id = policy(lab, owner); return { path: `/api/veritapolicy/policies/${id}`, body: { policy_name: "Changed" }, snap: row("veritapolicy_lab_policies", id) }; });
  add("DELETE", "policy", "veritapolicy", (lab, owner) => { const id = policy(lab, owner); return { path: `/api/veritapolicy/policies/${id}`, snap: row("veritapolicy_lab_policies", id) }; });

  // VeritaPace, VeritaShift, VeritaStock, VeritaOps
  add("DELETE", "productivity month", "veritabench", (lab, owner) => { const id = seed("productivity_months", { account_id: owner, lab_id: lab, year: 2000 + (++n % 900), month: 1 + (n % 12) }); return { path: `/api/productivity/${id}`, snap: row("productivity_months", id) }; }, { ownRows: true });
  add("POST", "staffing attest", "veritabench", (lab, owner) => { const id = staffing(lab, owner); return { path: `/api/staffing-studies/${id}/attest-adequacy`, body: { determination: "adequate", attested_by: "Made Up" }, snap: row("staffing_studies", id) }; }, { ownRows: true });
  add("POST", "staffing data", "veritabench", (lab, owner) => { const id = staffing(lab, owner); return { path: `/api/staffing-studies/${id}/data`, body: [{ week_number: 1, day_of_week: 1, hour_slot: 1, metric_type: "received", value: 3 }], snap: count("staffing_hourly_data", "study_id", id) }; }, { ownRows: true });
  add("DELETE", "staffing study", "veritabench", (lab, owner) => { const id = staffing(lab, owner); return { path: `/api/staffing-studies/${id}`, snap: row("staffing_studies", id) }; }, { ownRows: true });
  add("PUT", "inventory item", "veritastock", (lab, owner) => { const id = item(lab, owner); return { path: `/api/inventory/${id}`, body: { item_name: "Changed" }, snap: row("inventory_items", id) }; });
  add("POST", "inventory lead time", "veritastock", (lab, owner) => { const id = item(lab, owner); return { path: `/api/inventory/${id}/lead-time`, body: { lead_time_days: 9 }, snap: row("inventory_items", id) }; });
  add("DELETE", "inventory item", "veritastock", (lab, owner) => { const id = item(lab, owner); return { path: `/api/inventory/${id}`, snap: row("inventory_items", id) }; });
  add("PUT", "cost study", "veritaops", (lab, owner) => { const id = cost(lab, owner); return { path: `/api/veritaops/studies/${id}`, body: { test_name: "Changed" }, snap: row("veritaops_test_cost_studies", id) }; });
  add("DELETE", "cost study", "veritaops", (lab, owner) => { const id = cost(lab, owner); return { path: `/api/veritaops/studies/${id}`, snap: row("veritaops_test_cost_studies", id) }; });

  // VeritaTrack
  add("PUT", "task", "veritatrack", (lab, owner) => { const id = task(lab, owner); return { path: `/api/veritatrack/tasks/${id}`, body: { name: "Changed", category: "Other", frequency: "Monthly" }, snap: row("veritatrack_tasks", id) }; });
  add("DELETE", "task", "veritatrack", (lab, owner) => { const id = task(lab, owner); return { path: `/api/veritatrack/tasks/${id}`, snap: row("veritatrack_tasks", id) }; });
  add("POST", "sign-off void", "veritatrack", (lab, owner) => { const id = signoff(lab, owner); return { path: `/api/veritatrack/signoffs/${id}/void`, body: { reason: "made up" }, snap: row("veritatrack_signoffs", id) }; });
  add("DELETE", "sign-off", "veritatrack", (lab, owner) => { const id = signoff(lab, owner); return { path: `/api/veritatrack/signoffs/${id}`, body: { reason: "made up" }, snap: row("veritatrack_signoffs", id) }; });

  return out;
}
