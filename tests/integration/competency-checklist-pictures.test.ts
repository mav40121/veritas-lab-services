// tests/integration/competency-checklist-pictures.test.ts
//
// BUG-114 (2026-10-28, RFGH Brandy Morgan: "When I click in to edit to add pictures: Am I doing something wrong?").
// A non-technical checklist item could not hold a picture, so the Gram stain slides on her MediaLab checklist had
// nowhere to go. An item now carries one picture, stored once per lab (competency_checklist_images) and pointed at by
// the item and by every assessment that snapshots it. This pins the server side:
//   1. normalize accepts a picture or a kept picture id, and refuses a link, an oversized picture, a bad id
//   2. create and edit store the picture once and point the item at it; the same picture is not stored twice
//   3. the program detail sends one id -> picture map; an unchanged picture is kept by id
//   4. a saved assessment keeps the picture it was done on after the checklist gets a new one
//   5. another lab's picture id is refused before anything changes (lab route and legacy route)
//   6. the audit log never holds the picture itself
// Run: npm run test:competency-checklist-pictures

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { normalizeChecklistItems } from "../../shared/competencyChecklist";
import { withChecklistImages } from "../../server/competencyChecklistImages";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

// Two different 1x1 PNGs (made up; no patient data).
const PIC1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const PIC2 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  // 1) pure helper
  const ok = normalizeChecklistItems([{ description: "Perform 10 Gram stains" }, { description: "Describe Specimen #1", image: PIC1 }, { description: "Describe Specimen #2", imageId: 7 }]);
  check("1a. normalize keeps a new picture and a kept picture id", "items" in ok && ok.items[0].image === null && ok.items[0].imageId === null && ok.items[1].image === PIC1 && ok.items[2].imageId === 7, JSON.stringify(ok).slice(0, 200));
  const link = normalizeChecklistItems([{ description: "x", image: "https://example.com/slide.png" }]);
  check("1b. normalize refuses a link", "error" in link && link.error.includes("Item A") && link.error.includes("not a link"), JSON.stringify(link));
  const big = normalizeChecklistItems([{ description: "x", image: "data:image/png;base64," + "A".repeat(900_001) }]);
  check("1c. normalize refuses an oversized picture", "error" in big && big.error.includes("too large"), JSON.stringify(big).slice(0, 120));
  const badId = normalizeChecklistItems([{ description: "x", imageId: -3 }]);
  check("1d. normalize refuses a bad picture id", "error" in badId, JSON.stringify(badId));
  const svg = normalizeChecklistItems([{ description: "x", image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }]);
  check("1e. normalize refuses an SVG (only PNG, JPEG, GIF, WebP)", "error" in svg, JSON.stringify(svg));

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
  const pw = ["Zq", "pics", "7x!"].join("-");
  const reg = async (tag: string) => {
    const email = `it-chkpic-${tag}-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: pw, name: `IT ${tag}`, hipaa_acknowledged: true });
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };

  try {
    const owner = await reg("owner");
    const other = await reg("other");
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: owner.email, labName: "IT Pictures Lab", plan: "hospital" })).body.labId);
    const L2 = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: other.email, labName: "IT Other Lab", plan: "hospital" })).body.labId);
    const T = svc(owner.id), T2 = svc(other.id);
    check("0. setup: two labs, two owners", L > 0 && L2 > 0 && L !== L2);

    const images = (lab: number) => sqlite.prepare("SELECT id, data_url FROM competency_checklist_images WHERE lab_id = ? ORDER BY id").all(lab) as any[];
    const created = await call("POST", `/api/labs/${L}/competency/programs`, {
      name: "Gram Stain Competency", department: "Microbiology", type: "nontechnical",
      checklistItems: [{ description: "Perform 10 Gram stains with supervisor review in agreement" }, { description: "Describe what is on this Gram stain (Specimen #1)", image: PIC1 }, { description: "Describe what is on this Gram stain (Specimen #2)", image: PIC1 }],
    }, T, L);
    const P = Number(created.body.id);
    const items = () => sqlite.prepare("SELECT label, description, image_id FROM competency_checklist_items WHERE program_id = ? ORDER BY sort_order").all(P) as any[];
    const img1 = images(L);
    check("2a. create stores the picture once (two items, same picture) and points both items at it",
      created.status === 200 && img1.length === 1 && img1[0].data_url === PIC1 && items()[0].image_id === null && items()[1].image_id === img1[0].id && items()[2].image_id === img1[0].id,
      `${created.status} imgs=${img1.length} ${JSON.stringify(items())}`);
    const id1 = Number(img1[0].id);

    const putUrl = `/api/labs/${L}/competency/programs/${P}`;
    const detail = await call("GET", putUrl, undefined, T, L);
    check("3a. the program detail sends the picture once in checklistImages, items carry the id",
      detail.status === 200 && detail.body.checklistImages?.[String(id1)] === PIC1 && Object.keys(detail.body.checklistImages).length === 1 && detail.body.checklistItems[1].image_id === id1 && !("image" in detail.body.checklistItems[1]),
      JSON.stringify(detail.body.checklistImages ? Object.keys(detail.body.checklistImages) : null));

    // An assessment done on this checklist.
    const emp = await call("POST", `/api/labs/${L}/competency/employees`, { name: "Casey Tech", title: "MLT", hireDate: "2026-01-05" }, T, L);
    const cur = items();
    const asmt = await call("POST", `/api/labs/${L}/competency/assessments`, {
      programId: P, employeeId: emp.body.id, assessmentType: "initial", assessmentDate: "2026-10-28", evaluatorName: "Pat Lead", evaluatorTitle: "Technical Consultant", evaluatorInitials: "PL", competencyType: "nontechnical", status: "pass",
      items: cur.map(i => ({ itemLabel: i.label, itemDescription: i.description, ntItemLabel: i.label, ntItemDescription: i.description, ntDateMet: "2026-10-28", ntEmployeeInitials: "CT", ntSupervisorInitials: "PL", dateMet: "2026-10-28", employeeInitials: "CT", supervisorInitials: "PL", passed: true })),
    }, T, L);
    const aId = Number(asmt.body.id);
    const aItems = () => sqlite.prepare("SELECT nt_item_label, nt_item_image_id FROM competency_assessment_items WHERE assessment_id = ? ORDER BY id").all(aId) as any[];
    check("4a. the saved assessment points items B and C at the picture, A at none",
      asmt.status === 200 && aItems().map(i => `${i.nt_item_label}:${i.nt_item_image_id ?? "-"}`).join(",") === `A:-,B:${id1},C:${id1}`, JSON.stringify(aItems()));

    // Text-only edit that keeps the picture by id: no new picture row, same id.
    const auditBefore = Number((sqlite.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE entity_type = 'program_checklist' AND entity_id = ?").get(String(P)) as any).c);
    const keep = await call("PUT", putUrl, { checklistItems: [{ description: "Perform 10 Gram stains with supervisor review in agreement" }, { description: "Describe Specimen #1 (reworded)", imageId: id1 }, { description: "Describe what is on this Gram stain (Specimen #2)", imageId: id1 }] }, T, L);
    check("3b. a text edit keeps the picture by id and stores nothing new", keep.status === 200 && images(L).length === 1 && items()[1].image_id === id1 && items()[1].description === "Describe Specimen #1 (reworded)", `${keep.status} ${JSON.stringify(keep.body)}`);

    // A new picture on item C.
    const swap = await call("PUT", putUrl, { checklistItems: [{ description: "Perform 10 Gram stains with supervisor review in agreement" }, { description: "Describe Specimen #1 (reworded)", imageId: id1 }, { description: "Describe what is on this Gram stain (Specimen #2)", image: PIC2 }] }, T, L);
    const img2 = images(L);
    const id2 = Number(img2[img2.length - 1]?.id);
    check("2b. a new picture is stored as a new row and the item points at it", swap.status === 200 && img2.length === 2 && id2 !== id1 && items()[2].image_id === id2, `${swap.status} imgs=${img2.length}`);
    check("4b. the saved assessment still points at the picture it was done on", aItems()[2].nt_item_image_id === id1, JSON.stringify(aItems()));
    const forPdf = withChecklistImages(sqlite, sqlite.prepare("SELECT * FROM competency_assessment_items WHERE assessment_id = ? ORDER BY id").all(aId) as any[]);
    check("4c. the PDF rows carry the old picture for item C and none for item A", forPdf[2].nt_item_image === PIC1 && !("nt_item_image" in forPdf[0]), String(forPdf[2].nt_item_image).slice(0, 40));

    // Picture removed.
    const remove = await call("PUT", putUrl, { checklistItems: [{ description: "Perform 10 Gram stains with supervisor review in agreement" }, { description: "Describe Specimen #1 (reworded)" }, { description: "Describe what is on this Gram stain (Specimen #2)", imageId: id2 }] }, T, L);
    check("2c. removing a picture clears the item; stored pictures stay for saved records", remove.status === 200 && items()[1].image_id === null && images(L).length === 2, String(remove.status));

    // Another lab's picture id.
    const p2 = await call("POST", `/api/labs/${L2}/competency/programs`, { name: "Other", department: "Microbiology", type: "nontechnical", checklistItems: [{ description: "Item" }] }, T2, L2);
    const P2 = Number(p2.body.id);
    const steal = await call("PUT", `/api/labs/${L2}/competency/programs/${P2}`, { name: "Renamed", checklistItems: [{ description: "Item", imageId: id1 }] }, T2, L2);
    const p2Row = sqlite.prepare("SELECT name FROM competency_programs WHERE id = ?").get(P2) as any;
    const p2Items = sqlite.prepare("SELECT image_id FROM competency_checklist_items WHERE program_id = ?").all(P2) as any[];
    check("5a. another lab's picture id is refused before anything changes", steal.status === 400 && p2Row.name === "Other" && p2Items.every(r => r.image_id === null), `${steal.status} ${JSON.stringify(steal.body)}`);
    const legacySteal = await call("PUT", `/api/competency/programs/${P2}`, { checklistItems: [{ description: "Item", imageId: id1 }] }, T2, L2);
    check("5b. the legacy route refuses it too", legacySteal.status === 400 && (sqlite.prepare("SELECT image_id FROM competency_checklist_items WHERE program_id = ?").all(P2) as any[]).every(r => r.image_id === null), `${legacySteal.status} ${JSON.stringify(legacySteal.body)}`);

    const auditRows = sqlite.prepare("SELECT * FROM audit_log WHERE entity_type = 'program_checklist' AND entity_id = ? ORDER BY id").all(String(P)) as any[];
    const auditBlob = JSON.stringify(auditRows.slice(auditBefore));
    check("6a. the checklist edits are audit-logged without the picture itself", auditRows.length === auditBefore + 3 && !auditBlob.includes("data:image") && auditBlob.includes("new picture") && auditBlob.includes(`picture #${id1}`), `rows ${auditBefore}->${auditRows.length}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
