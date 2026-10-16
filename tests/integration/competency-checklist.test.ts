// tests/integration/competency-checklist.test.ts
//
// BUG-064 (Michael 2026-10-16: "In the non-technical competency it appears we can no longer edit the
// checklists?" / "I'm telling you I could not edit"). A non-technical program's checklist could only be
// set inside the New Program wizard; the 10/14 header shortcut skips the wizard and no screen edited an
// existing program's checklist. The Overview tab now saves it through PUT .../competency/programs/:id
// { checklistItems }. This pins the server side of that:
//   1. letters A..Z, AA, AB ... (item 27 used to become "[")
//   2. create and edit reject an empty list or a blank item, and change nothing when they do
//   3. an edit replaces the list in order and is audit-logged with before and after
//   4. a saved assessment keeps the items it was done on after the checklist changes
//   5. only a non-technical program takes a checklist; another lab's URL gets 404; the legacy route validates too
//   6. matchSavedChecklistRows keeps a reopened assessment's data on the right item after a reorder
// Run: npm run test:competency-checklist

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { checklistLabel, normalizeChecklistItems, matchSavedChecklistRows } from "../../shared/competencyChecklist";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  // 1 + 6) pure helpers
  check("1a. letters run A..Z then AA, AB", [0, 1, 25, 26, 27, 51, 52, 701, 702].map(checklistLabel).join(",") === "A,B,Z,AA,AB,AZ,BA,ZZ,AAA", [0, 1, 25, 26, 27, 51, 52, 701, 702].map(checklistLabel).join(","));
  const n = normalizeChecklistItems([{ description: "  Tour Department " }, { description: "Line one\r\nLine two  " }, "Plain string item"]);
  check("1b. normalize trims, keeps line breaks, re-letters", "items" in n && n.items.map(i => `${i.label}:${i.description}`).join("|") === "A:Tour Department|B:Line one\nLine two|C:Plain string item", JSON.stringify(n));
  check("1c. normalize rejects an empty list", "error" in normalizeChecklistItems([]));
  check("1d. normalize rejects a blank item and names it", (() => { const r = normalizeChecklistItems([{ description: "x" }, { description: "   " }]); return "error" in r && r.error.includes("Item B"); })());
  check("1e. normalize rejects more than 200 items", "error" in normalizeChecklistItems(Array.from({ length: 201 }, (_, i) => ({ description: `i${i}` }))));
  const savedRows = [{ label: "A", description: "Tour" }, { label: "B", description: "Policies" }, { label: "C", description: "QC" }];
  const reordered = [{ label: "A", description: "QC" }, { label: "B", description: "Tour" }, { label: "C", description: "Policies (reworded)" }];
  // Reworded AND moved: its letter's row now belongs to another item, so it gets nothing (blank, the
  // evaluator re-enters it) rather than a guess that could show a date on an item never done.
  check("6a. a reorder keeps each saved row on its item by wording; a reworded item whose letter moved gets nothing", JSON.stringify(matchSavedChecklistRows(reordered, savedRows)) === JSON.stringify([2, 0, null]), JSON.stringify(matchSavedChecklistRows(reordered, savedRows)));
  check("6b. a new item with no saved row gets nothing", JSON.stringify(matchSavedChecklistRows([...reordered, { label: "D", description: "New" }], savedRows)) === JSON.stringify([2, 0, null, null]));
  const reworded = [{ label: "A", description: "Tour" }, { label: "B", description: "Policies and Procedures" }, { label: "C", description: "QC" }];
  check("6c. an item only reworded (same place) keeps its row by letter", JSON.stringify(matchSavedChecklistRows(reworded, savedRows)) === JSON.stringify([0, 1, 2]));
  const removedMiddle = [{ label: "A", description: "Tour" }, { label: "B", description: "QC" }];
  check("6d. removing an item does not shift data onto the next item", JSON.stringify(matchSavedChecklistRows(removedMiddle, savedRows)) === JSON.stringify([0, 2]));

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
  const pw = ["Zq", "check", "7x!"].join("-");
  const reg = async (tag: string) => {
    const email = `it-checklist-${tag}-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: pw, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };

  try {
    const owner = await reg("owner");
    const other = await reg("other");
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "IT Checklist Lab", plan: "hospital" })).body.labId);
    const L2 = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: other.email, labName: "IT Other Lab", plan: "hospital" })).body.labId);
    const T = svc(owner.id), T2 = svc(other.id);
    check("0. setup: two labs, two owners", L > 0 && L2 > 0 && L !== L2);

    const programsUrl = `/api/labs/${L}/competency/programs`;
    const countPrograms = () => Number((sqlite.prepare("SELECT COUNT(*) AS c FROM competency_programs WHERE lab_id = ?").get(L) as any).c);
    const before = countPrograms();
    const badCreate = await call("POST", programsUrl, { name: "Manual Procedures non-technical competency", department: "Manual Procedures", type: "nontechnical", checklistItems: [{ description: "Tour" }, { description: "" }] }, T, L);
    check("2a. create with a blank item is refused and makes no program", badCreate.status === 400 && countPrograms() === before, `${badCreate.status} ${JSON.stringify(badCreate.body)}`);

    const created = await call("POST", programsUrl, { name: "Manual Procedures non-technical competency", department: "Manual Procedures", type: "nontechnical", checklistItems: [{ label: "A", description: "Tour Department" }, { label: "B", description: "Policies and Procedures" }, { label: "C", description: "Quality Control" }] }, T, L);
    const P = Number(created.body.id);
    const items = () => sqlite.prepare("SELECT label, description, sort_order FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(P) as any[];
    check("2b. create saves the checklist in order", created.status === 200 && items().map(i => `${i.label}:${i.description}`).join("|") === "A:Tour Department|B:Policies and Procedures|C:Quality Control", JSON.stringify(items()));

    // a saved assessment on the original checklist
    const emp = await call("POST", `/api/labs/${L}/competency/employees`, { name: "Casey Tech", title: "MLT", hireDate: "2026-01-05" }, T, L);
    const asmt = await call("POST", `/api/labs/${L}/competency/assessments`, {
      programId: P, employeeId: emp.body.id, assessmentType: "orientation", assessmentDate: "2026-10-15", evaluatorName: "Pat Lead", evaluatorTitle: "Technical Consultant", evaluatorInitials: "PL", competencyType: "nontechnical", status: "pass",
      items: items().map(i => ({ itemLabel: i.label, itemDescription: i.description, ntItemLabel: i.label, ntItemDescription: i.description, ntDateMet: "2026-10-15", ntEmployeeInitials: "CT", ntSupervisorInitials: "PL", dateMet: "2026-10-15", employeeInitials: "CT", supervisorInitials: "PL", passed: true })),
    }, T, L);
    const aId = Number(asmt.body.id);
    check("4a. setup: an assessment saved on the original checklist", asmt.status === 200 && aId > 0, `${asmt.status} ${JSON.stringify(asmt.body).slice(0, 160)}`);

    const putUrl = `/api/labs/${L}/competency/programs/${P}`;
    const blankEdit = await call("PUT", putUrl, { checklistItems: [{ description: "Tour Department" }, { description: "  " }] }, T, L);
    check("2c. an edit with a blank item is refused and changes nothing", blankEdit.status === 400 && items().length === 3, `${blankEdit.status} ${JSON.stringify(blankEdit.body)}`);
    const emptyEdit = await call("PUT", putUrl, { checklistItems: [] }, T, L);
    check("2d. an edit that empties the checklist is refused", emptyEdit.status === 400 && items().length === 3, String(emptyEdit.status));

    const detailed = [
      "Quality Control\nRun and document both levels before patient testing",
      "Tour Department",
      "Policies and Procedures (reworded)",
      ...Array.from({ length: 27 }, (_, i) => `Detailed item ${i + 1}`),
    ];
    const auditBefore = Number((sqlite.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity_type = 'program_checklist' AND entity_id = ?").get(String(P)) as any).c);
    const edit = await call("PUT", putUrl, { checklistItems: detailed.map(description => ({ description })) }, T, L);
    const after = items();
    check("3a. the edit saves: reworded, reordered, 27 added, line breaks kept", edit.status === 200 && after.length === 30 && after[0].description === detailed[0] && after[2].description === "Policies and Procedures (reworded)", `${edit.status} n=${after.length}`);
    check("3b. letters run past Z (AA..AD), with no '[' or other symbols", after.map(i => i.label).slice(24).join(",") === "Y,Z,AA,AB,AC,AD" && after.every(i => /^[A-Z]+$/.test(i.label)), after.map(i => i.label).join(","));
    const detail = await call("GET", putUrl, undefined, T, L);
    check("3c. the program detail returns the new checklist", detail.status === 200 && detail.body.checklistItems?.length === 30 && detail.body.checklistItems[0].description === detailed[0]);
    const audit = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'program_checklist' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(String(P)) as any;
    const auditAfter = Number((sqlite.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity_type = 'program_checklist' AND entity_id = ?").get(String(P)) as any).c);
    const blob = audit ? JSON.stringify(audit) : "";
    check("3d. the edit is audit-logged once, with the old and new items", auditAfter === auditBefore + 1 && blob.includes("Policies and Procedures (reworded)") && blob.includes("Quality Control") && blob.includes("Tour Department"), `rows ${auditBefore}->${auditAfter}`);

    const savedItems = sqlite.prepare("SELECT nt_item_label, nt_item_description FROM competency_assessment_items WHERE assessment_id = ? ORDER BY id").all(aId) as any[];
    check("4b. the saved assessment still has the 3 items it was done on", savedItems.length === 3 && savedItems.map(i => `${i.nt_item_label}:${i.nt_item_description}`).join("|") === "A:Tour Department|B:Policies and Procedures|C:Quality Control", JSON.stringify(savedItems));

    const tech = await call("POST", programsUrl, { name: "IT Technical", department: "Chemistry", type: "technical", methodGroups: [] }, T, L);
    const techEdit = await call("PUT", `/api/labs/${L}/competency/programs/${tech.body.id}`, { checklistItems: [{ description: "x" }] }, T, L);
    check("5a. a technical program does not take a checklist", techEdit.status === 400 && Number((sqlite.prepare("SELECT COUNT(*) AS c FROM competency_checklist_items WHERE program_id = ?").get(tech.body.id) as any).c) === 0, String(techEdit.status));
    const cross = await call("PUT", `/api/labs/${L2}/competency/programs/${P}`, { checklistItems: [{ description: "hijack" }] }, T2, L2);
    check("5b. another lab's URL cannot edit this checklist (404) and nothing changes", cross.status === 404 && items().length === 30, String(cross.status));
    const legacyBlank = await call("PUT", `/api/competency/programs/${P}`, { checklistItems: [{ description: "" }] }, T, L);
    check("5c. the legacy route validates too", legacyBlank.status === 400 && items().length === 30, String(legacyBlank.status));
    const nameOnly = await call("PUT", putUrl, { name: "Manual Procedures non-technical competency (renamed)" }, T, L);
    check("5d. a name-only save leaves the checklist alone", nameOnly.status === 200 && items().length === 30);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
