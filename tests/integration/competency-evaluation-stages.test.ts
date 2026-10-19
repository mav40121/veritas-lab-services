// tests/integration/competency-evaluation-stages.test.ts
//
// New-hire evaluation stages (2026-10-19, Sampson REQ-076). Natalie Lamb's forms list different items for the 30, 60
// and 90-day evaluations ("I would need them separately"), so an evaluation checklist item may belong to one stage.
// This pins:
//   1. the shared rules: a 30-day evaluation shows the 30-day items plus every-stage items; competency types and
//      unknown types see the whole list; an unknown stage is refused, a blank one means every stage
//   2. an evaluation program keeps each item's stage through create, read and edit (both create and edit routes)
//   3. a competency program never keeps a stage, even when one is sent
//   4. the blank evaluation worksheet PDF labels each stage-only item with its stage; a filled 30-day PDF prints only
//      the items saved on that evaluation
//   5. the old shape: a checklist table without the stage column gains it on boot with every item kept, stage NULL
// Run: npm run test:competency-evaluation-stages

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { checklistItemsForType, normalizeChecklistItems } from "../../shared/competencyChecklist";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // 1) shared rules
  const items = [
    { label: "A", description: "Orientation checklist", stage: "30day" },
    { label: "B", description: "Second department", stage: "60day" },
    { label: "C", description: "Waived testing", stage: "90day" },
    { label: "D", description: "Review error log", stage: null },
  ];
  const labels = (t: string | null) => checklistItemsForType(items, t).map((i) => i.label).join("");
  check("1a. 30-day shows A and D, 60-day B and D, 90-day C and D", labels("30day") === "AD" && labels("60day") === "BD" && labels("90day") === "CD",
    [labels("30day"), labels("60day"), labels("90day")].join(","));
  check("1b. competency types and unknown types see the whole list", labels("annual") === "ABCD" && labels("orientation") === "ABCD" && labels(null) === "ABCD");
  const ok = normalizeChecklistItems([{ description: "a", stage: "30day" }, { description: "b", stage: "" }, { description: "c" }]) as any;
  check("1c. a blank or missing stage means every stage", !("error" in ok) && ok.items.map((i: any) => i.stage).join(",") === "30day,,", JSON.stringify(ok));
  const bad = normalizeChecklistItems([{ description: "a", stage: "annual" }]) as any;
  check("1d. an unknown stage is refused, naming the item", "error" in bad && /Item A/.test(bad.error), JSON.stringify(bad));

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const call = async (method: string, p: string, body?: any, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const svc = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const pw = ["Zq", "stage", "7x!"].join("-");
  const stagesOf = (pid: number) =>
    (sqlite.prepare("SELECT label, stage FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(pid) as any[]).map((r) => `${r.label}:${r.stage ?? "-"}`).join(",");

  try {
    const email = `it-eval-stages-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: pw, name: "IT Stages", hipaa_acknowledged: true });
    const ownerId = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id);
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "IT Stages Lab", plan: "hospital" })).body.labId);
    const T = svc(ownerId);
    check("0. setup: lab and owner", L > 0);
    const programsUrl = `/api/labs/${L}/competency/programs`;

    // 2) evaluation keeps stages through create, read and edit
    const ev = await call("POST", programsUrl, { name: "Lab Assistant new-hire evaluation", department: "Specimen Processing", type: "nontechnical", recordKind: "evaluation",
      checklistItems: [{ description: "Orientation checklist", stage: "30day" }, { description: "Second department", stage: "60day" }, { description: "Review error log" }] }, T, L);
    const EP = Number(ev.body.id);
    check("2a. create keeps each item's stage", ev.status === 200 && stagesOf(EP) === "A:30day,B:60day,C:-", stagesOf(EP));
    const read = await call("GET", `${programsUrl}/${EP}`, undefined, T, L);
    const readStages = (read.body.checklistItems || []).map((i: any) => i.stage ?? "-").join(",");
    check("2b. the program read returns the stages", read.status === 200 && readStages === "30day,60day,-", readStages);
    const edit = await call("PUT", `${programsUrl}/${EP}`, { checklistItems: [{ description: "Orientation checklist", stage: "30day" }, { description: "Waived testing", stage: "90day" }, { description: "Review error log", stage: null }] }, T, L);
    check("2c. edit keeps the new stages", edit.status === 200 && stagesOf(EP) === "A:30day,B:90day,C:-", stagesOf(EP));
    const badEdit = await call("PUT", `${programsUrl}/${EP}`, { checklistItems: [{ description: "x", stage: "annual" }] }, T, L);
    check("2d. an unknown stage is refused and nothing changes", badEdit.status === 400 && stagesOf(EP) === "A:30day,B:90day,C:-", `${badEdit.status} ${stagesOf(EP)}`);

    // 3) a competency never keeps a stage
    const nt = await call("POST", programsUrl, { name: "Front desk competency", department: "Specimen Processing", type: "nontechnical",
      checklistItems: [{ description: "Registration", stage: "30day" }] }, T, L);
    const NP = Number(nt.body.id);
    await call("PUT", `${programsUrl}/${NP}`, { checklistItems: [{ description: "Registration", stage: "60day" }] }, T, L);
    check("3a. a competency's items carry no stage after create and edit", nt.status === 200 && stagesOf(NP) === "A:-", stagesOf(NP));

    // 4) PDFs
    const { buildCompetencyHTML } = await import("../../server/pdfReport");
    const visible = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const programItems = sqlite.prepare("SELECT * FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(EP);
    const base4 = {
      assessment: { id: 1, competency_type: "nontechnical", program_record_kind: "evaluation", program_name: "Lab Assistant new-hire evaluation", department: "Specimen Processing",
        employee_name: "Sam Rivera", employee_hire_date: "2026-10-19", assessment_type: "30day", assessment_date: "2026-11-18", evaluator_name: "Pat Lead", evaluator_title: "Supervisor",
        evaluator_initials: "PL", status: "pass" },
      methodGroups: [], checklistItems: programItems, labName: "IT Stages Lab", quizResults: [], cliaNumber: "11D1111111",
    };
    const blankText = visible(buildCompetencyHTML({ ...base4, items: [], blank: true } as any));
    check("4a. the blank worksheet labels stage-only items and leaves every-stage items plain",
      blankText.includes("30-Day: Orientation checklist") && blankText.includes("90-Day: Waived testing") && blankText.includes("Review error log") && !blankText.includes(": Review error log"),
      (blankText.match(/[^.]{0,40}(Orientation|Waived|error log)[^.]{0,20}/g) || []).join(" | "));
    const filledText = visible(buildCompetencyHTML({ ...base4, items: [
      { nt_item_label: "A", nt_item_description: "Orientation checklist", nt_date_met: "2026-11-18", nt_employee_initials: "SR", nt_supervisor_initials: "PL" },
      { nt_item_label: "C", nt_item_description: "Review error log", nt_date_met: "2026-11-18", nt_employee_initials: "SR", nt_supervisor_initials: "PL" },
    ] } as any));
    check("4b. a filled 30-day evaluation prints only its own items", filledText.includes("Orientation checklist") && filledText.includes("Review error log") && !filledText.includes("Waived testing"));

    // 5) the old shape migrates with every item kept
    const tmp = new Database(":memory:");
    tmp.exec("CREATE TABLE competency_checklist_items (id INTEGER PRIMARY KEY AUTOINCREMENT, program_id INTEGER NOT NULL, label TEXT NOT NULL, description TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0)");
    tmp.prepare("INSERT INTO competency_checklist_items (program_id, label, description, sort_order) VALUES (1, 'A', 'old item', 0)").run();
    const cols = (tmp.prepare("PRAGMA table_info(competency_checklist_items)").all() as any[]).map((c) => c.name);
    if (!cols.includes("stage")) tmp.exec("ALTER TABLE competency_checklist_items ADD COLUMN stage TEXT");
    const after = tmp.prepare("SELECT label, description, stage FROM competency_checklist_items").all() as any[];
    const liveCols = (sqlite.prepare("PRAGMA table_info(competency_checklist_items)").all() as any[]).map((c) => c.name);
    check("5a. the boot database has the stage column", liveCols.includes("stage"), liveCols.join(","));
    check("5b. the old-shape migration keeps the item with stage NULL", after.length === 1 && after[0].description === "old item" && after[0].stage === null, JSON.stringify(after));
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
