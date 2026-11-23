// tests/integration/veritaqa-stewardship.test.ts
//
// Receipt for the VeritaQA Stewardship tab, minimum version (parking lot #81; Michael Veri 2026-11-23, Decision 14 = 2). Real
// routes on a scratch database with made-up people, labs and totals (no lab's real data). Proves:
//   1. the five tables exist with lab_id; settings read the defaults until set; only the owner or an admin changes them; a bad
//      value is refused and nothing changes
//   2. a draft antibiogram: title and period checked; the grid saves whole or not at all (a bad count, S over tested, S+I+R over
//      tested, a repeated organism and antimicrobial pair are each refused and nothing is saved)
//   3. the LIS totals upload: a file with a patient column (or any unknown column) is refused by name and nothing is saved;
//      preview checks without saving; quoted fields, a BOM and CRLF read right; the table is organisms down, antimicrobials across
//   4. the math: whole percent susceptible, a cell under the threshold suppressed (or shown and marked in flag mode), an organism's
//      isolates the most tested for any of its antimicrobials
//   5. release: needs who approved it and some totals; then the version is locked (grid, upload, edit, delete all 409) and keeps
//      the rule it was released under when the settings change later, while a draft follows the new settings
//   6. a new version is a draft copy (version 2, previous_id), the released one unchanged; a second draft of it is refused
//   7. the workbook: About first and active, lab identity on the About row and in every sheet's header and footer, the percent
//      table and the totals, every sheet protected, no em dash anywhere
//   8. the committee log and action items, and the readiness view (CFR rows only, verbatim, as-of date) going from not met to met
//   9. reach: another owner's lab, a sister lab's path for lab A's admin, a view-only seat and a Staff login are refused; a lab
//      with no suite plan 403; another lab's antibiogram id is 404 on this lab's path
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { claimPdfToken } = await import("../../server/pdfTokens");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";

  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const call = (method: string, p: string, body?: unknown, token?: string) =>
    fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const stamp = Date.now();
  const now = new Date().toISOString();
  const mkUser = async (tag: string) => {
    const email = `steward-${tag}-${stamp}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true }));
    return { email, token: reg.token as string, id: Number(reg.user?.id) };
  };
  const mkLab = async (ownerEmail: string, name: string, plan = "hospital") =>
    (await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: name, plan }))).labId as number;
  const OA = await mkUser("ownerA");
  const OB = await mkUser("ownerB");
  const labA = await mkLab(OA.email, "Stewardship Main");
  const labA2 = await mkLab(OA.email, "Stewardship Annex");
  const labB = await mkLab(OB.email, "Stewardship Other Owner");
  check("setup: two labs for one owner and one for another", !!labA && !!labA2 && !!labB);
  const B = (lab: number) => `/api/labs/${lab}/veritaqa/stewardship`;
  const cnt = (sql: string, ...a: unknown[]) => Number((sqlite.prepare(sql).get(...a) as any).n);

  // ── 1. Tables and settings ─────────────────────────────────────────────
  const tables = ["stewardship_settings", "stewardship_antibiograms", "stewardship_antibiogram_rows", "stewardship_meetings", "stewardship_actions"];
  check("1a. the five tables exist, each with lab_id", tables.every((t) => (sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).some((c) => c.name === "lab_id")));
  check("1b. no column anywhere names a patient", tables.every((t) => !(sqlite.prepare(`PRAGMA table_info(${t})`).all() as any[]).some((c) => /patient|mrn|dob|birth|accession/i.test(c.name))));
  const s0 = await j(await call("GET", `${B(labA)}/settings`, undefined, OA.token));
  check("1c. settings read the defaults until set (30, suppress, 12 months) and name the M39 check", s0.settings?.isolate_threshold === 30 && s0.settings?.below_threshold === "suppress" && s0.settings?.period_months === 12 && /M39 ED5 \(2022\)/.test(s0.pending_note || "") && s0.can_edit === true, JSON.stringify(s0));
  const bad = await call("PUT", `${B(labA)}/settings`, { isolate_threshold: 0 }, OA.token);
  check("1d. a threshold of 0 is refused, nothing stored", bad.status === 400 && (await j(bad)).code === "BAD_SETTINGS" && cnt("SELECT COUNT(*) AS n FROM stewardship_settings WHERE lab_id = ?", labA) === 0);
  const badMode = await call("PUT", `${B(labA)}/settings`, { below_threshold: "hide" }, OA.token);
  check("1e. a mode other than suppress or flag is refused", badMode.status === 400);

  const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 1, ?, ?, ?)`).run(lab, userId, role, now, now, now);
  const seat = (lab: number, u: { id: number; email: string }, type: string, perms: string) => sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(OA.id, u.email, u.id, now, now, perms, `stew-${u.id}-${lab}-${stamp}`, lab, type);
  const ADMINU = await mkUser("admin");
  const EDITOR = await mkUser("editor");
  const VIEWER = await mkUser("viewer");
  const STAFF = await mkUser("staff");
  member(labA, ADMINU.id, "admin");
  member(labA, EDITOR.id); seat(labA, EDITOR, "active", '{"mode":"edit_all"}');
  member(labA, VIEWER.id); seat(labA, VIEWER, "view_only", '{"mode":"view_all"}');
  member(labA, STAFF.id); seat(labA, STAFF, "staff_portal", '{"mode":"view_all"}');
  const byEditor = await call("PUT", `${B(labA)}/settings`, { isolate_threshold: 10 }, EDITOR.token);
  check("1f. an editor with edit on everything can't change the settings (owner or admin only)", byEditor.status === 403 && (await j(byEditor)).code === "OWNER_OR_ADMIN_ONLY" && cnt("SELECT COUNT(*) AS n FROM stewardship_settings WHERE lab_id = ?", labA) === 0);
  const byAdmin = await call("PUT", `${B(labA)}/settings`, { isolate_threshold: 30, below_threshold: "suppress", period_months: 12 }, ADMINU.token);
  check("1g. an admin can", byAdmin.status === 200 && cnt("SELECT COUNT(*) AS n FROM stewardship_settings WHERE lab_id = ?", labA) === 1);
  const edRead = await j(await call("GET", `${B(labA)}/settings`, undefined, EDITOR.token));
  check("1h. the editor reads them and is told it can't change them", edRead.settings?.isolate_threshold === 30 && edRead.can_edit === false);

  // ── 2. A draft and the grid ────────────────────────────────────────────
  const noTitle = await call("POST", `${B(labA)}/antibiograms`, { period_start: "2025-01-01", period_end: "2025-12-31" }, OA.token);
  const backwards = await call("POST", `${B(labA)}/antibiograms`, { title: "2025", period_start: "2025-12-31", period_end: "2025-01-01" }, OA.token);
  check("2a. a draft needs a title and a period that runs forward", noTitle.status === 400 && backwards.status === 400);
  const created = await call("POST", `${B(labA)}/antibiograms`, { title: "Made-up 2025 antibiogram", period_start: "2025-01-01", period_end: "2025-12-31", source_filter: "All sources", data_source: "Made-up LIS report" }, EDITOR.token);
  const A1 = (await j(created)).id as number;
  check("2b. an editor creates a draft", created.status === 201 && !!A1);
  const rows = [
    { organism: "Escherichia coli", organism_group: "gram-negative", antimicrobial: "Ampicillin", tested: 400, susceptible: 210 },
    { organism: "Escherichia coli", organism_group: "gram-negative", antimicrobial: "Ceftriaxone", tested: 412, susceptible: 362, intermediate: 10, resistant: 40 },
    { organism: "Enterobacter cloacae complex", organism_group: "GN", antimicrobial: "Ceftriaxone", tested: 18, susceptible: 13 },
    { organism: "Staphylococcus aureus", organism_group: "gram positive", antimicrobial: "Oxacillin", tested: 188, susceptible: 109 },
    { organism: "Staphylococcus aureus", organism_group: "gram positive", antimicrobial: "Vancomycin", tested: 188, susceptible: 188 },
  ];
  const G = (id: number) => `${B(labA)}/antibiograms/${id}`;
  for (const [label, badRow] of [
    ["a count that isn't a whole number", { organism: "X", antimicrobial: "Y", tested: "12.5", susceptible: 3 }],
    ["susceptible over tested", { organism: "X", antimicrobial: "Y", tested: 10, susceptible: 11 }],
    ["S+I+R over tested", { organism: "X", antimicrobial: "Y", tested: 10, susceptible: 6, intermediate: 3, resistant: 3 }],
    ["tested of 0", { organism: "X", antimicrobial: "Y", tested: 0, susceptible: 0 }],
    ["a blank organism", { organism: "", antimicrobial: "Y", tested: 10, susceptible: 1 }],
  ] as const) {
    const r = await call("PUT", `${G(A1)}/rows`, { rows: [...rows, badRow] }, EDITOR.token);
    check(`2c. ${label} is refused and nothing is saved`, r.status === 400 && (await j(r)).code === "BAD_ROWS" && cnt("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?", A1) === 0);
  }
  const dup = await j(await call("PUT", `${G(A1)}/rows`, { rows: [...rows, { ...rows[0], tested: 5, susceptible: 1 }] }, EDITOR.token));
  check("2d. the same organism and antimicrobial twice is refused, naming the first line", dup.code === "BAD_ROWS" && dup.errors?.some((e: any) => /already on line 1/.test(e.message)), JSON.stringify(dup.errors));
  const saved = await j(await call("PUT", `${G(A1)}/rows`, { rows }, EDITOR.token));
  check("2e. good rows save, in order", saved.rows?.length === 5 && saved.rows[0].antimicrobial === "Ampicillin" && saved.rows[2].organism_group === "gram_negative" && saved.rows[3].organism_group === "gram_positive", JSON.stringify(saved.rows));

  // ── 4. The math (on the saved draft) ───────────────────────────────────
  const gn = saved.table?.find((g: any) => g.group === "gram_negative");
  const gp = saved.table?.find((g: any) => g.group === "gram_positive");
  const ec = gn?.organisms.find((o: any) => o.organism === "Escherichia coli");
  const ent = gn?.organisms.find((o: any) => o.organism === "Enterobacter cloacae complex");
  check("4a. two blocks, gram-negative first; drugs across in the order they came", saved.table?.length === 2 && saved.table[0].group === "gram_negative" && JSON.stringify(gn.drugs) === JSON.stringify(["Ampicillin", "Ceftriaxone"]));
  check("4b. whole percent susceptible: 210/400 = 53 (52.5 rounds up), 362/412 = 88 (87.86)", ec.cells.Ampicillin.pct === 53 && ec.cells.Ceftriaxone.pct === 88, JSON.stringify(ec.cells));
  check("4c. an organism's isolates is the most tested for any of its drugs (412)", ec.isolates === 412);
  check("4d. 18 tested is under 30: below, and not shown in suppress mode", ent.below === true && ent.cells.Ceftriaxone.below === true && ent.cells.Ceftriaxone.shown === false);
  check("4e. 188/188 = 100, 109/188 = 58", gp.organisms[0].cells.Vancomycin.pct === 100 && gp.organisms[0].cells.Oxacillin.pct === 58);
  await call("PUT", `${B(labA)}/settings`, { below_threshold: "flag" }, OA.token);
  const flagged = await j(await call("GET", G(A1), undefined, OA.token));
  const entF = flagged.table.find((g: any) => g.group === "gram_negative").organisms.find((o: any) => o.organism === "Enterobacter cloacae complex");
  check("4f. flag mode: the draft shows the 72 and keeps it marked below", entF.cells.Ceftriaxone.shown === true && entF.cells.Ceftriaxone.below === true && entF.cells.Ceftriaxone.pct === 72);
  await call("PUT", `${B(labA)}/settings`, { below_threshold: "suppress" }, OA.token);

  // ── 3. The LIS totals upload ───────────────────────────────────────────
  const A2 = (await j(await call("POST", `${B(labA)}/antibiograms`, { title: "Made-up upload", period_start: "2025-01-01", period_end: "2025-12-31" }, OA.token))).id as number;
  const phiFile = "Patient Name,MRN,Organism,Antimicrobial,Tested,Susceptible\nMade Up,123,Escherichia coli,Ampicillin,1,1\n";
  const phi = await call("POST", `${G(A2)}/upload`, { csv: phiFile }, OA.token);
  const phiJ = await j(phi);
  check("3a. a file with a patient column is refused by name, nothing saved", phi.status === 400 && phiJ.code === "UNKNOWN_COLUMNS" && phiJ.unknown_columns.includes("patient name") && phiJ.unknown_columns.includes("mrn") && cnt("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?", A2) === 0, JSON.stringify(phiJ));
  const missing = await j(await call("POST", `${G(A2)}/upload`, { csv: "Organism,Antimicrobial,Tested\nX,Y,3\n" }, OA.token));
  check("3b. a file without the susceptible column is refused", /Missing columns: susceptible/.test(missing.errors?.[0]?.message || ""), JSON.stringify(missing));
  const goodFile = "﻿Organism,Group,Drug,Number Tested,Number Susceptible,I,R\r\n\"Klebsiella pneumoniae, ESBL-negative\",Gram-negative,Ceftriaxone,133,120,2,11\r\nKlebsiella pneumoniae,gram negative,\"Trimethoprim-sulfamethoxazole\",\"1,330\",\"1,131\",,\r\n";
  const prev = await j(await call("POST", `${G(A2)}/upload`, { csv: goodFile, preview: true }, OA.token));
  check("3c. preview reads the BOM, CRLF, quoted commas and 1,330; nothing is saved", prev.preview === true && prev.row_count === 2 && prev.rows[0].organism === "Klebsiella pneumoniae, ESBL-negative" && prev.rows[1].tested === 1330 && prev.rows[1].susceptible === 1131 && cnt("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?", A2) === 0, JSON.stringify(prev.rows));
  const badLine = await j(await call("POST", `${G(A2)}/upload`, { csv: "Organism,Antimicrobial,Tested,Susceptible\nX,Y,10,4\nX,Z,10,40\n" }, OA.token));
  check("3d. a bad line names its file line (3) and nothing is saved", badLine.code === "BAD_ROWS" && badLine.errors?.[0]?.line === 3 && cnt("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?", A2) === 0, JSON.stringify(badLine));
  const up = await call("POST", `${G(A2)}/upload`, { csv: goodFile }, OA.token);
  check("3e. the upload saves", up.status === 200 && cnt("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ? AND lab_id = ?", A2, labA) === 2);

  // ── 5. Release ─────────────────────────────────────────────────────────
  const noWho = await call("POST", `${G(A1)}/release`, { released_by_name: "Dr. Made Up" }, EDITOR.token);
  check("5a. release needs the approver's name and title", noWho.status === 400);
  const empty = (await j(await call("POST", `${B(labA)}/antibiograms`, { title: "Empty", period_start: "2025-01-01", period_end: "2025-12-31" }, OA.token))).id as number;
  check("5b. release needs some totals", (await call("POST", `${G(empty)}/release`, { released_by_name: "Dr. Made Up", released_by_title: "Medical Director" }, OA.token)).status === 400);
  const rel = await j(await call("POST", `${G(A1)}/release`, { released_by_name: "Dr. Made Up", released_by_title: "Medical Director" }, EDITOR.token));
  check("5c. released: status, the rule used (30, suppress), who approved it, the lab-local release day", rel.antibiogram?.status === "released" && rel.antibiogram.threshold_used === 30 && rel.antibiogram.below_threshold_used === "suppress" && rel.antibiogram.released_by_name === "Dr. Made Up" && /^\d{4}-\d{2}-\d{2}$/.test(rel.antibiogram.released_day || ""), JSON.stringify(rel.antibiogram));
  const lockedRows = await call("PUT", `${G(A1)}/rows`, { rows }, OA.token);
  const lockedUp = await call("POST", `${G(A1)}/upload`, { csv: goodFile }, OA.token);
  const lockedEdit = await call("PUT", G(A1), { title: "Changed" }, OA.token);
  const lockedDel = await call("DELETE", G(A1), undefined, OA.token);
  check("5d. a released version is locked: grid, upload, edit 409 RELEASED_LOCKED; delete 409 RELEASED_KEPT",
    lockedRows.status === 409 && lockedUp.status === 409 && lockedEdit.status === 409 && lockedDel.status === 409 && (await j(lockedDel)).code === "RELEASED_KEPT" && cnt("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?", A1) === 5);
  await call("PUT", `${B(labA)}/settings`, { isolate_threshold: 10 }, OA.token);
  const relLater = await j(await call("GET", G(A1), undefined, OA.token));
  const entRel = relLater.table.find((g: any) => g.group === "gram_negative").organisms.find((o: any) => o.organism === "Enterobacter cloacae complex");
  check("5e. the threshold moved to 10 later: the released version still suppresses the 18 (its rule was 30)", relLater.rule?.threshold === 30 && entRel.cells.Ceftriaxone.shown === false);
  const draftLater = await j(await call("GET", G(A2), undefined, OA.token));
  check("5f. a draft follows today's settings (10)", draftLater.rule?.threshold === 10);
  await call("PUT", `${B(labA)}/settings`, { isolate_threshold: 30 }, OA.token);
  check("5g. the release is in the audit trail", cnt("SELECT COUNT(*) AS n FROM audit_log WHERE module = 'veritaqa' AND action = 'release' AND entity_type = 'stewardship_antibiogram' AND entity_id = ?", String(A1)) === 1);

  // ── 6. A new version ───────────────────────────────────────────────────
  const nv = await call("POST", `${G(A1)}/new-version`, undefined, OA.token);
  const A1v2 = (await j(nv)).id as number;
  const v2 = await j(await call("GET", G(A1v2), undefined, OA.token));
  check("6a. a new version is a draft copy: version 2, previous_id, the same 5 rows", nv.status === 201 && v2.antibiogram?.status === "draft" && v2.antibiogram.version === 2 && v2.antibiogram.previous_id === A1 && v2.rows.length === 5);
  const again = await call("POST", `${G(A1)}/new-version`, undefined, OA.token);
  check("6b. a second open draft of the same version is refused", again.status === 409 && (await j(again)).code === "DRAFT_EXISTS");
  await call("PUT", `${G(A1v2)}/rows`, { rows: rows.slice(0, 2) }, OA.token);
  check("6c. changing version 2 leaves version 1 as released", cnt("SELECT COUNT(*) AS n FROM stewardship_antibiogram_rows WHERE antibiogram_id = ?", A1) === 5);
  const list = await j(await call("GET", `${B(labA)}/antibiograms`, undefined, OA.token));
  check("6d. the list shows every version with its row count", list.items?.filter((i: any) => i.title === "Made-up 2025 antibiogram").length === 2);
  const delDraft = await call("DELETE", G(empty), undefined, OA.token);
  check("6e. a draft can be deleted", delDraft.status === 200 && cnt("SELECT COUNT(*) AS n FROM stewardship_antibiograms WHERE id = ?", empty) === 0);

  // ── 7. The workbook ────────────────────────────────────────────────────
  sqlite.prepare("UPDATE labs SET clia_number = '99D9999999' WHERE id = ?").run(labA);
  const x = await j(await call("POST", `${G(A1)}/xlsx`, {}, OA.token));
  const tok = x.token ? claimPdfToken(x.token) : null;
  const buf: Buffer | null = tok ? tok.buffer : null;
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  let wbOk = false;
  try { await wb.xlsx.load(buf as any); wbOk = true; } catch (e: any) { console.log("workbook load:", e?.message); }
  check("7a. the workbook builds and loads", !!x.token && /VeritaQA_Antibiogram_Made-up_2025_antibiogram_v1\.xlsx/.test(x.filename || "") && wbOk, JSON.stringify(x));
  if (wbOk) {
    const names = wb.worksheets.map((w: any) => w.name);
    check("7b. sheets: About, Antibiogram, Totals, About first and active", JSON.stringify(names) === JSON.stringify(["About", "Antibiogram", "Totals"]) && (wb.views?.[0] as any)?.activeTab === 0, JSON.stringify(names));
    const about = wb.getWorksheet("About")!;
    check("7c. lab identity on the About row", String(about.getCell("A2").value).includes("Stewardship Main") && String(about.getCell("A2").value).includes("CLIA: 99D9999999"));
    check("7d. lab identity in every sheet's header and footer", wb.worksheets.every((w: any) => String(w.headerFooter?.oddHeader).includes("CLIA: 99D9999999") && String(w.headerFooter?.oddFooter).includes("CLIA: 99D9999999")));
    check("7e. every sheet is protected", wb.worksheets.every((w: any) => !!(w as any).sheetProtection?.sheet));
    const abg = wb.getWorksheet("Antibiogram")!;
    const texts: string[] = [];
    abg.eachRow((r: any) => r.eachCell((c: any) => texts.push(String(c.value ?? ""))));
    check("7f. the table: 53 and 88 for E. coli, * for the 18-isolate cell, both group bars", texts.includes("53") && texts.includes("88") && texts.includes("*") && texts.includes("Gram-negative organisms") && texts.includes("Gram-positive organisms"), texts.slice(0, 40).join("|"));
    const tot = wb.getWorksheet("Totals")!;
    check("7g. the totals sheet has one row per organism and antimicrobial (5) with its percent", tot.rowCount === 6 && Number(tot.getRow(2).getCell(8).value) === 53);
    const all: string[] = [];
    wb.worksheets.forEach((w: any) => { w.eachRow((r: any) => r.eachCell((c: any) => all.push(String(c.value ?? "")))); all.push(String(w.headerFooter?.oddHeader), String(w.headerFooter?.oddFooter)); });
    check("7h. no em dash anywhere in the workbook", !all.some((s) => s.includes(String.fromCharCode(0x2014))));
  }

  // ── 8. Committee log, actions, readiness ───────────────────────────────
  const r0 = await j(await call("GET", `${B(labA)}/readiness`, undefined, OA.token));
  check("8a. readiness: CFR rows only, verbatim (b)(2)(i) for 482.42 and 485.640, as of 2026-11-19", r0.cfr?.length === 2 && r0.cfr[0].citation === "42 CFR 482.42(b)(2)(i)" && r0.cfr[1].citation === "42 CFR 485.640(b)(2)(i)" && /^\(i\) Demonstrates coordination among all components of the CAH/.test(r0.cfr[1].text) && r0.cfr_as_of === "2026-11-19");
  const st = (r: any, k: string) => r.items?.find((i: any) => i.key === k)?.state;
  check("8b. released antibiogram: met; no meeting logged: not met; no actions: met", st(r0, "antibiogram") === "met" && st(r0, "committee") === "not_met" && st(r0, "actions") === "met", JSON.stringify(r0.items));
  check("8c. a meeting needs a date and the lab's representative; a minutes link must be http(s)",
    (await call("POST", `${B(labA)}/meetings`, { lab_representative: "M. Tech" }, OA.token)).status === 400 &&
    (await call("POST", `${B(labA)}/meetings`, { meeting_date: r0.today }, OA.token)).status === 400 &&
    (await call("POST", `${B(labA)}/meetings`, { meeting_date: r0.today, lab_representative: "M. Tech", minutes_link: "javascript:alert(1)" }, OA.token)).status === 400);
  const M1 = (await j(await call("POST", `${B(labA)}/meetings`, { meeting_date: r0.today, lab_representative: "M. Tech, Microbiology", minutes_link: "https://example.com/minutes", notes: "Made-up meeting" }, EDITOR.token))).id as number;
  const past = "2020-01-15";
  const act = await call("POST", `${B(labA)}/meetings/${M1}/actions`, { action: "Send the made-up antibiogram to pharmacy", owner: "M. Tech", due_date: past }, EDITOR.token);
  const ACT = (await j(act)).id as number;
  const r1 = await j(await call("GET", `${B(labA)}/readiness`, undefined, OA.token));
  check("8d. a meeting today: committee met; an open action past due: actions not met", st(r1, "committee") === "met" && st(r1, "actions") === "not_met", JSON.stringify(r1.items));
  await call("PUT", `${B(labA)}/actions/${ACT}`, { status: "done", completed_on: r0.today }, EDITOR.token);
  const r2 = await j(await call("GET", `${B(labA)}/readiness`, undefined, OA.token));
  check("8e. the action marked done: actions met", st(r2, "actions") === "met");
  const ml = await j(await call("GET", `${B(labA)}/meetings`, undefined, OA.token));
  check("8f. the log lists the meeting with its action", ml.items?.length === 1 && ml.items[0].actions?.length === 1 && ml.items[0].actions[0].status === "done");
  check("8g. a bad action status or due date is refused", (await call("PUT", `${B(labA)}/actions/${ACT}`, { status: "maybe" }, OA.token)).status === 400 && (await call("PUT", `${B(labA)}/actions/${ACT}`, { due_date: "soon" }, OA.token)).status === 400);
  const dm = await call("DELETE", `${B(labA)}/meetings/${M1}`, undefined, OA.token);
  check("8h. removing a meeting removes its actions", dm.status === 200 && cnt("SELECT COUNT(*) AS n FROM stewardship_actions WHERE meeting_id = ?", M1) === 0);

  // ── 9. Reach ───────────────────────────────────────────────────────────
  for (const [name, u] of [["a view-only seat", VIEWER], ["a Staff login", STAFF], ["another lab's owner", OB]] as const) {
    const g = await call("GET", `${B(labA)}/antibiograms`, undefined, u.token);
    const p = await call("POST", `${B(labA)}/antibiograms`, { title: "Nope", period_start: "2025-01-01", period_end: "2025-12-31" }, u.token);
    check(`9a. ${name}: read and write refused`, g.status === 403 && p.status === 403, `${g.status} ${p.status}`);
  }
  const adminSister = await call("GET", `${B(labA2)}/antibiograms`, undefined, ADMINU.token);
  check("9b. lab A's admin can't reach the sister lab's path", adminSister.status === 403, String(adminSister.status));
  const crossId = await call("GET", G(A1).replace(`/labs/${labA}/`, `/labs/${labA2}/`), undefined, OA.token);
  check("9c. lab A's antibiogram id on the sister lab's path is 404", crossId.status === 404);
  const free = await mkUser("free");
  const freeLab = await mkLab(free.email, "Stewardship No Plan");
  sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(freeLab);
  sqlite.prepare("UPDATE users SET plan = 'free' WHERE id = ?").run(free.id);
  check("9d. no suite plan: 403", (await call("GET", `${B(freeLab)}/antibiograms`, undefined, free.token)).status === 403);

  server.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
