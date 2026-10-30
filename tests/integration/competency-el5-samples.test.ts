// tests/integration/competency-el5-samples.test.ts
//
// Element 5 "+ Add another sample" (Michael Q71 = 1, 2026-10-30; RFGH): one person's Element 5 for one test system can
// record more than one blind / PT sample. Sample 1 stays in el5_sample_type / el5_sample_id / el5_acceptable so every
// older reader keeps working; el5_samples_json holds the list when there is more than one. Scratch DB, made-up people.
// This pins:
//   0. the pure helpers: blank rows dropped, values trimmed, the list capped, sample 1 read from the columns
//   1. the person page save with three samples (one blank) stores two, sample 1 in the columns, the list in JSON
//   2. the person page read returns every sample, and the element is PASS
//   3. a save with the single fields (older callers) is one sample with no JSON; a one-sample list writes no JSON
//   4. an edit to sample 1 through the columns (the Staff Portal path) wins over the copy in the list
//   5. all-blank samples leave the element incomplete; more than the cap stores the cap
//   6. the competency PDF prints every sample, one line each
// Run: npm run test:competency-el5-samples

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { buildCompetencyHTML } from "../../server/pdfReport";
import { cleanEl5Samples, el5Columns, el5SamplesFromRow, EL5_MAX_SAMPLES } from "../../shared/competencyEl5Samples";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  // 0. pure helpers
  const cleaned = cleanEl5Samples([
    { sampleType: " PT ", sampleId: " CHM-26A-01 ", acceptable: true },
    { sampleType: "", sampleId: "", acceptable: null },
    { sampleType: "Blind", sampleId: "B-7", acceptable: false },
  ]);
  check("0a. blank rows dropped, values trimmed, order kept",
    cleaned.length === 2 && cleaned[0].sampleType === "PT" && cleaned[0].sampleId === "CHM-26A-01" && cleaned[1].acceptable === false,
    JSON.stringify(cleaned));
  const one = el5Columns(cleaned.slice(0, 1));
  const two = el5Columns(cleaned);
  check("0b. one sample writes the columns only; two write the list too",
    one.json === null && one.id === "CHM-26A-01" && one.acceptable === 1 && two.json !== null && JSON.parse(two.json).length === 2);
  check("0c. sample 1 is read from the columns even when the list holds an older copy",
    el5SamplesFromRow({ el5_sample_type: "PT", el5_sample_id: "NEW-1", el5_acceptable: 1, el5_samples_json: JSON.stringify([{ sampleType: "PT", sampleId: "OLD-1", acceptable: true }, { sampleType: "PT", sampleId: "S-2", acceptable: true }]) })
      .map((s) => s.sampleId).join(",") === "NEW-1,S-2");
  check("0d. unreadable JSON falls back to sample 1; an empty row reads as no samples",
    el5SamplesFromRow({ el5_sample_id: "A", el5_samples_json: "{not json" }).length === 1 && el5SamplesFromRow({}).length === 0);
  check("0e. the list is capped", cleanEl5Samples(Array.from({ length: 40 }, (_, i) => ({ sampleId: `S-${i}` }))).length === EL5_MAX_SAMPLES);

  const app = express(); app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app); await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address(); const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };

  try {
    const email = `it-el5-${Date.now()}@example.com`;
    const owner = (await call("POST", "/api/auth/register", { email, password: ["Zq", "el5", "7x!"].join("-"), name: "IT Element Five", hipaa_acknowledged: true })).j;
    const tk = owner.token;
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Sample Lab", plan: "hospital" })).j.labId);
    const L = `/api/labs/${labId}`;
    await call("POST", `${L}/staff/lab`, { labName: "Sample Lab", cliaNumber: "11D7654376", accreditationBody: "CLIA_ONLY", complexity: "high" }, tk, labId);
    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, tk, labId)).j.id;
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      { name: "Hemo Counter", category: "Hematology", tests: [{ analyte: "WBC", specialty: "Hematology", complexity: "MODERATE", active: 1 }] },
    ] });
    const INST = Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = 'Hemo Counter' AND map_id = ?").get(mapId) as any)?.id);
    const now = new Date().toISOString(); const today = now.slice(0, 10);
    const mk = async (body: any) => Number((await call("POST", `${L}/staff/employees`, body, tk, labId)).j.id);
    const tech = await mk({ lastName: "Lane", firstName: "Robin", highestComplexity: "M", performsTesting: true, hireDate: "2021-03-01" });
    sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(tech, INST, now);
    await mk({ lastName: "Vance", firstName: "Kit", highestComplexity: "H", roles: [{ role: "TC", specialtyNumber: 8 }] });
    check("0f. fixture: one moderate system, a tech assigned to it, a TC observer", INST > 0 && tech > 0);

    const els = (five: any) => [
      { num: 1, specimenId: "S-100", observerInitials: "KV", passed: true },
      { num: 2, evidence: "LIS result review", date: today, passed: true },
      { num: 3, qcDate: today, passed: true },
      { num: 4, dateObserved: today, observerInitials: "KV", passed: true },
      { num: 5, ...five },
      { num: 6, quizId: "Q-1", score: 100, dateTaken: today, passed: true },
    ];
    const put = (five: any) => call("PUT", `${L}/competency/employee/${tech}/test-system/${INST}`, { elements: els(five) }, tk, labId);
    const row5 = () => sqlite.prepare(
      "SELECT el5_sample_type, el5_sample_id, el5_acceptable, el5_samples_json FROM competency_assessment_items WHERE instrument_id = ? AND element_number = 5 AND signoff_id IS NULL"
    ).get(INST) as any;
    const view5 = async () => {
      const v = (await call("GET", `${L}/competency/employee/${tech}`, undefined, tk, labId)).j;
      const ts = (v.testSystems || []).find((t: any) => t.instrumentId === INST);
      return (ts?.elements || []).find((e: any) => e.num === 5);
    };

    // 1. three samples, one blank
    const r1 = await put({ passed: true, samples: [
      { sampleType: "PT", sampleId: "CAP-HE-A-01", acceptable: true },
      { sampleType: "", sampleId: "", acceptable: null },
      { sampleType: "PT", sampleId: "CAP-HE-A-02", acceptable: false },
    ] });
    const s1 = row5();
    const list1 = s1?.el5_samples_json ? JSON.parse(s1.el5_samples_json) : [];
    check("1. save with three samples (one blank) stores two: sample 1 in the columns, both in the list",
      r1.s === 200 && s1?.el5_sample_type === "PT" && s1?.el5_sample_id === "CAP-HE-A-01" && s1?.el5_acceptable === 1
        && list1.length === 2 && list1[1].sampleId === "CAP-HE-A-02" && list1[1].acceptable === false,
      `${r1.s} ${r1.j.error || ""} ${JSON.stringify(s1)}`);

    // 2. read back
    const v2 = await view5();
    check("2. the person page reads both samples back, the single fields carry sample 1, and the element is PASS",
      v2?.samples?.length === 2 && v2.samples[0].sampleId === "CAP-HE-A-01" && v2.samples[1].sampleId === "CAP-HE-A-02"
        && v2.sampleId === "CAP-HE-A-01" && v2.status === "pass",
      JSON.stringify(v2));

    // 3. older callers and a one-sample list
    const r3a = await put({ sampleType: "Blind", sampleId: "BL-9", acceptable: true, passed: true });
    const s3a = row5(); const v3a = await view5();
    check("3a. a save with the single fields is one sample with no list",
      r3a.s === 200 && s3a?.el5_sample_id === "BL-9" && s3a?.el5_samples_json == null && v3a?.samples?.length === 1 && v3a.samples[0].sampleType === "Blind",
      `${r3a.s} ${JSON.stringify(s3a)}`);
    const r3b = await put({ passed: true, samples: [{ sampleType: "PT", sampleId: "CAP-HE-B-01", acceptable: true }] });
    const s3b = row5();
    check("3b. a one-sample list writes the columns and no list", r3b.s === 200 && s3b?.el5_sample_id === "CAP-HE-B-01" && s3b?.el5_samples_json == null, JSON.stringify(s3b));

    // 4. sample 1 edited through the columns (the Staff Portal path) wins over the copy in the list
    await put({ passed: true, samples: [{ sampleType: "PT", sampleId: "OLD-1", acceptable: true }, { sampleType: "PT", sampleId: "TWO-2", acceptable: true }] });
    sqlite.prepare("UPDATE competency_assessment_items SET el5_sample_id = 'NEW-1' WHERE instrument_id = ? AND element_number = 5 AND signoff_id IS NULL").run(INST);
    const v4 = await view5();
    check("4. a column edit to sample 1 shows, and sample 2 is kept",
      (v4?.samples || []).map((s: any) => s.sampleId).join(",") === "NEW-1,TWO-2", JSON.stringify(v4?.samples));

    // 5. all blank, and the cap
    const r5a = await put({ passed: false, samples: [{ sampleType: "", sampleId: " ", acceptable: null }] });
    const s5a = row5(); const v5a = await view5();
    check("5a. all-blank samples store nothing and leave the element incomplete",
      r5a.s === 200 && s5a?.el5_sample_id == null && s5a?.el5_sample_type == null && s5a?.el5_acceptable == null && s5a?.el5_samples_json == null && v5a?.status === "incomplete",
      `${JSON.stringify(s5a)} ${v5a?.status}`);
    await put({ passed: true, samples: Array.from({ length: 30 }, (_, i) => ({ sampleType: "PT", sampleId: `S-${i + 1}`, acceptable: true })) });
    const s5b = row5();
    check("5b. more than the cap stores the cap", JSON.parse(s5b?.el5_samples_json || "[]").length === EL5_MAX_SAMPLES, String(JSON.parse(s5b?.el5_samples_json || "[]").length));

    // 6. the competency PDF prints every sample
    const html = buildCompetencyHTML({
      assessment: { competency_type: "technical", status: "pass", assessment_date: today, employee_name: "Robin Lane", employee_role: "MLS", assessment_type: "annual", evaluator_name: "Kit Vance", evaluator_title: "Technical Consultant", evaluator_initials: "KV" },
      items: [{ element_number: 5, method_number: 5, method_group_id: 1, method_group_name: "Hemo Counter", passed: 1,
        el5_sample_type: "PT", el5_sample_id: "CAP-HE-A-01", el5_acceptable: 1,
        el5_samples_json: JSON.stringify([{ sampleType: "PT", sampleId: "CAP-HE-A-01", acceptable: true }, { sampleType: "Blind", sampleId: "BL-22", acceptable: false }]) }],
      methodGroups: [{ id: 1, name: "Hemo Counter" }], checklistItems: [], labName: "Sample Lab", cliaNumber: "11D7654376", quizResults: [],
    } as any);
    check("6. the competency PDF prints both samples, one line each",
      html.includes("PT<br>Blind") && html.includes("CAP-HE-A-01<br>BL-22") && html.includes("Yes<br>No"));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
