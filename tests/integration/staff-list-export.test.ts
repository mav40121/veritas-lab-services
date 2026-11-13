// tests/integration/staff-list-export.test.ts
//
// STANDING integration test for VeritaStaff's "Download staff list" (Heywood 2026-11-13: "Other than the C209 form is
// there any way to print an employee list"). GET /api/labs/:labId/staff/employees/export.xlsx:
//   1. Returns a workbook (not swallowed by .../employees/:id) named VeritaStaff_Staff_List_<lab today>.xlsx.
//   2. About is sheet 1 and the opening tab, with the lab's name and CLIA; "Not on file" when the lab has no CLIA.
//   3. The Staff List sheet holds exactly the Staff tab's active roster, last name then first: no inactive person and
//      no other lab's person; roles carry their CMS specialty or "entire lab"; a non-tester has no competency columns.
//   4. Each tester's Competency is the Staff tab's badge for them (shared/staffListLabels.ts competencyBadgeLabel read
//      from the list route's own competencyStatus), so the two can't disagree.
//   5. House style and print layout: teal headers, the lab's identity in every page header and footer, landscape, one
//      page wide, the heading row repeated, frozen at C2, auto-filter, both sheets protected, no em dash.
//   6. Access: signed out 401; another lab's owner can't reach it; a Staff login limited to their own record gets
//      403 STAFF_OWN_ONLY, as the CMS 209 does.
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:staff-list-export

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail && !cond ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { competencyBadgeLabel } = await import("../../shared/staffListLabels");
  const { STAFF_LIST_COLUMNS } = await import("../../server/staffListExport");
  const { default: ExcelJS } = await import("exceljs");
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

  const call = async (method: string, path: string, body: unknown, token?: string) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j: any = {}; try { j = await r.json(); } catch { /* not JSON */ }
    return { s: r.status, j };
  };
  const download = async (labId: number, token?: string) => {
    const r = await fetch(`${base}/api/labs/${labId}/staff/employees/export.xlsx`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const buf = Buffer.from(await r.arrayBuffer());
    let json: any = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
    return { s: r.status, type: r.headers.get("content-type") || "", disposition: r.headers.get("content-disposition") || "", buf, json };
  };
  const register = async (tag: string) => {
    const email = `stafflist-${tag.toLowerCase()}-${stamp}@example.com`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);

  try {
    const OWNER = await register("Owner"), OWNER2 = await register("Owner2"), STAFF = await register("Staff");
    const labId = await provision(OWNER.email, "Made Up Gardner Lab");
    const lab2 = await provision(OWNER2.email, "Made Up Other Lab");
    const L = `/api/labs/${labId}`, L2 = `/api/labs/${lab2}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made Up Gardner Lab & Clinic", cliaNumber: "22D0999990", accreditationBody: "CLIA_ONLY", complexity: "high" }, OWNER.token);
    await call("POST", `${L2}/staff/lab`, { labName: "Made Up Other Lab", cliaNumber: "", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER2.token);

    const person = async (path: string, token: string, body: any) => Number((await call("POST", `${path}/staff/employees`, body, token)).j.id);
    const zulu = await person(L, OWNER.token, { lastName: "Zulu", firstName: "Amy", title: "MLS", highestComplexity: "H", performsTesting: true, hireDate: "2020-01-15", roles: [{ role: "TP" }] });
    const adams = await person(L, OWNER.token, { lastName: "Adams", firstName: "Ben", middleInitial: "M", title: "Lead MLS", highestComplexity: "M", performsTesting: true, hireDate: "2018-06-01", roles: [{ role: "TC", specialtyNumber: 8 }, { role: "TP" }] });
    const clark = await person(L, OWNER.token, { lastName: "Clark", firstName: "Cy", title: "Supervisor", highestComplexity: "W", performsTesting: false, hireDate: "2015-02-02", roles: [{ role: "GS" }] });
    const dropped = await person(L, OWNER.token, { lastName: "Dropped", firstName: "Dee", highestComplexity: "M", performsTesting: true, hireDate: "2019-09-09" });
    sqlite.prepare("UPDATE staff_employees SET status = 'inactive' WHERE id = ?").run(dropped);
    await person(L2, OWNER2.token, { lastName: "Other", firstName: "Oz", highestComplexity: "M", performsTesting: true, hireDate: "2017-07-07" });
    // Entire-lab TS role for Zulu, set directly (the form's own flag).
    const staffLabId = Number((sqlite.prepare("SELECT lab_id FROM staff_employees WHERE id = ?").get(zulu) as any).lab_id);
    sqlite.prepare("INSERT INTO staff_roles (employee_id, lab_id, role, specialty_number, all_specialties) VALUES (?, ?, 'TS', NULL, 1)").run(zulu, staffLabId);
    // Adams has an initial competency on file 60 days ago, so the two testers don't read the same badge.
    const sixtyAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    sqlite.prepare("UPDATE staff_competency_schedules SET initial_completed_at = ? WHERE employee_id = ?").run(sixtyAgo, adams);
    check("setup: four people on lab 1's roster, one inactive", [zulu, adams, clark, dropped].every((x) => x > 0));

    // ── 1. The download ──
    const d = await download(labId, OWNER.token);
    check("1a. owner gets 200", d.s === 200, `status ${d.s} ${JSON.stringify(d.json)}`);
    check("1b. Excel content type (not the employee-by-id JSON)", d.type.includes("spreadsheetml"), d.type);
    check("1c. filename VeritaStaff_Staff_List_<date>.xlsx", /filename="VeritaStaff_Staff_List_\d{4}-\d{2}-\d{2}\.xlsx"/.test(d.disposition), d.disposition);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(d.buf);
    const names = wb.worksheets.map((w: any) => w.name);
    check("2a. sheets are About then Staff List", names.join("|") === "About|Staff List", names.join("|"));
    check("2b. the workbook opens on About", (wb.views?.[0] as any)?.activeTab === 0, JSON.stringify(wb.views));
    const about = wb.getWorksheet("About")!;
    // Row 1 of the first sheet is the license band the repo stamps on every export (shared/licenseExceljs.ts), so the
    // About rows are found by their text.
    const aboutText: string[] = [];
    about.eachRow((row: any) => aboutText.push(row.getCell(1).text));
    const titleAt = aboutText.indexOf("VeritaStaff™ Staff List");
    check("2c. About title, right under the license band", titleAt >= 0 && titleAt <= 1, aboutText.slice(0, 3).join(" / "));
    check("2d. About names the lab and CLIA on the next row", aboutText[titleAt + 1] === "Prepared for: Made Up Gardner Lab & Clinic    CLIA: 22D0999990", aboutText[titleAt + 1]);
    check("2d. the license band names the product", aboutText[0].includes("VeritaStaff™"), aboutText[0]);
    check("2e. About counts 3 active staff, 2 testing", aboutText.some((t) => t.includes("Active staff: 3 (2 perform testing)")), aboutText.join(" / "));
    check("2f. About has the coverage-gaps email", aboutText.some((t) => t.includes("info@veritaslabservices.com")));

    const ws = wb.getWorksheet("Staff List")!;
    const header = (ws.getRow(1).values as any[]).slice(1).map(String);
    check("3a. headers are the column list", header.join("|") === STAFF_LIST_COLUMNS.map(([h]) => h).join("|"), header.join("|"));
    const rows: string[][] = [];
    ws.eachRow((row: any, n: number) => { if (n > 1) rows.push(STAFF_LIST_COLUMNS.map((_, i) => row.getCell(i + 1).text)); });
    check("3b. exactly the three active people, last name then first", rows.map((r) => r[0]).join(",") === "Adams,Clark,Zulu", rows.map((r) => r[0]).join(","));
    check("3c. no inactive person and no other lab's person", !rows.some((r) => r[0] === "Dropped" || r[0] === "Other"));
    const byLast = Object.fromEntries(rows.map((r) => [r[0], r]));
    check("3d. Adams: MI without a period, title, TC with its specialty", byLast.Adams[2] === "M" && byLast.Adams[3] === "Lead MLS" && byLast.Adams[4] === "TC (Hematology); TP", byLast.Adams.join(" | "));
    check("3e. Zulu: entire-lab TS listed after TP", byLast.Zulu[4] === "TP; TS (entire lab)", byLast.Zulu[4]);
    check("3f. complexity labels", byLast.Adams[5] === "Moderate" && byLast.Zulu[5] === "High" && byLast.Clark[5] === "Waived");
    check("3g. Clark doesn't test: No, and blank competency columns", byLast.Clark[6] === "No" && byLast.Clark[7] === "" && byLast.Clark[8] === "", byLast.Clark.join(" | "));
    check("3h. hire dates as stored", byLast.Adams[9] === "2018-06-01" && byLast.Clark[9] === "2015-02-02");

    // ── 4. Competency matches the Staff tab ──
    const list = (await call("GET", `${L}/staff/employees`, undefined, OWNER.token)).j as any[];
    for (const emp of list.filter((e) => e.performs_testing === 1)) {
      const screen = competencyBadgeLabel(emp.competencyStatus, !!emp.competencySchedule);
      const row = byLast[emp.last_name];
      check(`4. ${emp.last_name}: Competency "${row?.[7]}" is the Staff tab's badge "${screen}"`, row?.[7] === screen);
      check(`4. ${emp.last_name}: Next Competency Due is the list's next due`, (row?.[8] ?? "") === (emp.competencyStatus?.nextDue ?? ""), `${row?.[8]} vs ${emp.competencyStatus?.nextDue}`);
    }

    // ── 5. House style and print layout ──
    const h1 = ws.getCell("A1");
    check("5a. teal bold white header", (h1.fill as any)?.fgColor?.argb === "FF01696F" && (h1.font as any)?.bold === true && (h1.font as any)?.color?.argb === "FFFFFFFF");
    const identity = "Made Up Gardner Lab && Clinic    CLIA: 22D0999990"; // & doubled in header/footer codes
    check("5b. identity in the page header and footer of both sheets", [ws, about].every((s: any) => String(s.headerFooter?.oddHeader).includes(identity) && String(s.headerFooter?.oddFooter).includes(identity)), String(ws.headerFooter?.oddHeader));
    const ps: any = ws.pageSetup;
    check("5c. prints landscape, one page wide, heading row repeated", ps.orientation === "landscape" && ps.fitToWidth === 1 && ps.fitToHeight === 0 && ps.printTitlesRow === "1:1", JSON.stringify(ps));
    const view: any = ws.views?.[0];
    check("5d. frozen at C2", view?.state === "frozen" && view?.xSplit === 2 && view?.ySplit === 1, JSON.stringify(view));
    check("5e. auto-filter over the header row", !!ws.autoFilter);
    check("5f. both sheets protected", !!(ws as any).sheetProtection?.sheet && !!(about as any).sheetProtection?.sheet);
    // Excel opens a workbook with a header or footer over 255 characters only in repair mode (shared/licenseExceljs.ts).
    const hfParts = [ws, about].flatMap((s: any) => ["oddHeader", "oddFooter", "evenHeader", "evenFooter"].map((k) => String(s.headerFooter?.[k] ?? "")));
    check("5h. every header and footer is 255 characters or fewer (Excel opens it without repair)", hfParts.every((t) => t.length <= 255), hfParts.map((t) => t.length).join(","));
    const allText = [...aboutText, ...rows.flat(), ...header].join(" ");
    check("5g. no em dash anywhere", !allText.includes("—"));

    // ── 2g. No CLIA on file ──
    const d2 = await download(lab2, OWNER2.token);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(d2.buf);
    const about2: string[] = [];
    wb2.getWorksheet("About")!.eachRow((row: any) => about2.push(row.getCell(1).text));
    const prepared2 = about2.find((t) => t.startsWith("Prepared for:")) || "";
    check("2g. a lab with no CLIA reads Not on file", d2.s === 200 && prepared2.endsWith("CLIA: Not on file"), prepared2);

    // ── 6. Access ──
    const out = await download(labId);
    check("6a. signed out is 401", out.s === 401, `status ${out.s}`);
    const cross = await download(labId, OWNER2.token);
    check("6b. another lab's owner can't reach it", cross.s === 403 || cross.s === 404, `status ${cross.s}`);
    sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 0, ?, ?, ?)`).run(labId, STAFF.id, now, now, now);
    sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"view_all"}', ?, ?, 'staff_portal', ?)`)
      .run(OWNER.id, STAFF.email, STAFF.id, now, now, `stafflist-${stamp}`, labId, zulu);
    const own = await download(labId, STAFF.token);
    check("6c. a Staff login limited to their own record gets 403 STAFF_OWN_ONLY", own.s === 403 && own.json?.code === "STAFF_OWN_ONLY", `status ${own.s} ${JSON.stringify(own.json)}`);
    const ownList = (await call("GET", `${L}/staff/employees`, undefined, STAFF.token));
    check("6d. (the same login's Staff tab is limited too)", ownList.s === 200 && Array.isArray(ownList.j) && ownList.j.length <= 1, `status ${ownList.s} n=${ownList.j?.length}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
