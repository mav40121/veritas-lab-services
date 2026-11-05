// tests/integration/veritadc-readiness-report.test.ts
//
// Receipt for the VeritaDC readiness PDF finding (site review 2026-11-05). The tracker screen saves to
// veritapolicy_master_status and shows the master list; the PDF read veritapolicy_requirement_status, which nothing on the
// screen writes, so a lab's report said Not Started and 0% whatever the lab had entered.
//   1. The report's score and counts are the screen's, entered through the screen's own routes.
//   2. The report lists exactly the screen's rows, custom policies included, each with the screen's status and policy name.
//   3. Rows left in the old table don't reach the report.
//   4. The report carries the lab's name, CLIA and accreditor, and only that lab's entries.
//   5. The route without a lab in the URL gives the same answer.
//   6. Page 1 has the review block, and the report no longer prints settings the screen can't set or an empty library.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only) and reads the HTML the route hands to Chrome, so
// it checks what is printed. Run: npm run test:veritadc-readiness-report
// Set VERITADC_PDF_OUT to a file path to keep the PDF of the filled-in lab for a look.

import fs from "node:fs";
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { getBrowser } from "../../server/pdfReport";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET!;
  const PW = ["Report", "chk", "77!"].join("-");
  const now = new Date().toISOString();
  const call = async (method: string, p: string, body?: unknown, token?: string, labId?: number) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const bytes = Buffer.from(await r.arrayBuffer());
    let json: any = {};
    try { json = JSON.parse(bytes.toString()); } catch { /* a file, not JSON */ }
    return { status: r.status, body: json, bytes };
  };

  // What the route hands to Chrome is what prints.
  let printed = "";
  const browser: any = await getBrowser();
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async () => {
    const page = await newPage();
    const setContent = page.setContent.bind(page);
    page.setContent = async (html: string, options: any) => { printed = html; return setContent(html, options); };
    return page;
  };
  const report = async (path: string, token: string, labId: number) => {
    printed = "";
    const r = await call("POST", path, undefined, token, labId);
    const html = printed;
    const cells = (/<table class="summary-table">[\s\S]*?<tbody>\s*<tr>([\s\S]*?)<\/tr>/.exec(html)?.[1] ?? "").match(/<td[^>]*>[^<]*<\/td>/g)?.map((td) => td.replace(/<[^>]+>/g, "").trim()) ?? [];
    const rows = Array.from(html.matchAll(/<tr[^>]*data-policy-id="([^"]*)"[^>]*data-status="([^"]*)"/g)).map((m) => ({ id: m[1], status: m[2] }));
    return { ...r, html, cells, rows, score: /<div class="score-num">([^<]*)<\/div>/.exec(html)?.[1] ?? "" };
  };

  try {
    const email = `dcreport-${Date.now()}@example.com`;
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "Owner Madeup", hipaa_acknowledged: true });
    const T = reg.body.token as string;
    const userId = Number(reg.body.user?.id ?? reg.body.id);
    const labA = (await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: "Made-up Report Lab", plan: "hospital" })).body.labId as number;
    sqlite.prepare("UPDATE labs SET lab_name = 'Made-up Report Lab', clia_number = '22D0000771', accreditation_tjc = 1 WHERE id = ?").run(labA);
    const labB = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id, plan, subscription_status, created_at, updated_at) VALUES ('Made-up Second Lab', '22D0000772', ?, 'hospital', 'active', ?, ?)").run(userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'owner', 'active', 0, ?, ?, ?)").run(labB, userId, now, now, now);
    const A = `/api/labs/${labA}/veritapolicy`;
    const B = `/api/labs/${labB}/veritapolicy`;

    // The lab fills in the tracker the way the screen does.
    const blank = (await call("GET", `${A}/master-list`, undefined, T, labA)).body.rows as any[];
    check("setup: the screen lists the master list", blank?.length > 0, `${blank?.length} rows`);
    const patch = (root: string, labId: number, id: string, body: any) => call("PATCH", `${root}/master-list/${encodeURIComponent(id)}`, body, T, labId);
    const [r0, r1, r2, r3, r4, r5] = blank;
    await patch(A, labA, r0.policy_id, { status: "complete", our_policy_name: "Made-up QC Policy (POL-003)" });
    await patch(A, labA, r1.policy_id, { status: "complete" });
    await patch(A, labA, r2.policy_id, { status: "complete" });
    await patch(A, labA, r3.policy_id, { status: "in_progress", our_policy_name: "Safety <Plan> & Annex" });
    await patch(A, labA, r4.policy_id, { status: "in_progress" });
    await patch(A, labA, r5.policy_id, { status: "na", is_na: true });
    const custom = await call("POST", `${A}/custom-entries`, { policy_name: "Made-up Chemical Hygiene Plan", section: "Custom", cfr_citations: "42 CFR 493.9999", notes: "Made up" }, T, labA);
    await patch(A, labA, custom.body.policy_id, { status: "complete", our_policy_name: "Made-up Hygiene Binder" });
    await call("PUT", `${A}/settings`, { is_independent: 1, setup_complete: 1 }, T, labA);

    // An old-table row the screen never wrote, under a requirement id and a policy name that would show.
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
      sqlite.prepare("INSERT INTO veritapolicy_requirement_status (user_id, lab_id, requirement_id, status, is_na, policy_name, updated_at) VALUES (?, ?, ?, 'complete', 0, 'Old table policy name', ?)").run(userId, labA, id, now);
    }

    const screen = (await call("GET", `${A}/master-list`, undefined, T, labA)).body;
    const summary = (await call("GET", `${A}/master-list/summary`, undefined, T, labA)).body;
    check("setup: the screen shows what was entered", summary.complete === 4 && summary.in_progress === 2 && summary.na === 1 && summary.total === blank.length + 1 && summary.applicable === blank.length && summary.score === Math.round((4 / blank.length) * 100), JSON.stringify(summary));

    // ── 1. Score and counts ─────────────────────────────────────────────────────────────────────────────────────────
    const a = await report(`${A}/pdf`, T, labA);
    check("1. the route returns a PDF", a.status === 200 && a.bytes.subarray(0, 5).toString() === "%PDF-", `HTTP ${a.status} ${a.body.error ?? ""}`);
    check("1. the report's score is the screen's, not 0%", a.score === `${summary.score}%` && summary.score > 0, `report ${a.score}, screen ${summary.score}%`);
    check("1. the report's counts are the screen's", a.cells.join("|") === [summary.applicable, summary.complete, summary.in_progress, summary.not_started, summary.na, `${summary.score}%`].join("|"), `report ${a.cells.join("|")} screen ${summary.applicable}|${summary.complete}|${summary.in_progress}|${summary.not_started}|${summary.na}|${summary.score}%`);

    // ── 2. Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────
    const screenRows = screen.rows as any[];
    const inReport = new Map(a.rows.map((r) => [r.id, r.status]));
    check("2. the report has one row per screen row", a.rows.length === screenRows.length && inReport.size === screenRows.length, `report ${a.rows.length}, screen ${screenRows.length}`);
    check("2. every row has the screen's status", screenRows.every((r) => inReport.get(String(r.policy_id)) === r.status), JSON.stringify(screenRows.filter((r) => inReport.get(String(r.policy_id)) !== r.status).slice(0, 3).map((r) => [r.policy_id, r.status, inReport.get(String(r.policy_id))])));
    check("2. every row prints the screen's policy name", screenRows.every((r) => a.html.includes(esc(r.policy_name))), JSON.stringify(screenRows.filter((r) => !a.html.includes(esc(r.policy_name))).slice(0, 2).map((r) => r.policy_name)));
    check("2. every section heading on the screen is in the report", Array.from(new Set(screenRows.map((r) => r.section))).every((s) => a.html.includes(esc(String(s)))));
    check("2. the lab's policy name prints", a.html.includes("Made-up QC Policy (POL-003)") && a.html.includes("Made-up Hygiene Binder"));
    check("2. the lab's text is escaped", a.html.includes("Safety &lt;Plan&gt; &amp; Annex") && !a.html.includes("Safety <Plan>"));
    check("2. the custom policy is in the report as complete", inReport.get(String(custom.body.policy_id)) === "complete" && a.html.includes("Made-up Chemical Hygiene Plan"), String(inReport.get(String(custom.body.policy_id))));
    check("2. the N/A row reads N/A", inReport.get(String(r5.policy_id)) === "na");
    const tjc = (screenRows.find((r) => r.policy_id === r0.policy_id)?.ao_citations || []).find((c: any) => c.label === "TJC")?.value as string;
    check("2. the screen's citations print: CFR and the lab's accreditor", a.html.includes(esc(r0.cfr_citations)) && !!tjc && a.html.includes(esc(tjc)), String(tjc).slice(0, 40));

    // ── 3. The old table ────────────────────────────────────────────────────────────────────────────────────────────
    check("3. rows left in the old table don't reach the report", !a.html.includes("Old table policy name"));
    const labC = Number(sqlite.prepare("INSERT INTO labs (lab_name, clia_number, owner_user_id, plan, subscription_status, created_at, updated_at) VALUES ('Made-up Old Table Lab', '22D0000773', ?, 'hospital', 'active', ?, ?)").run(userId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'owner', 'active', 0, ?, ?, ?)").run(labC, userId, now, now, now);
    for (const id of [1, 2, 3, 4, 5, 6, 7, 8]) {
      sqlite.prepare("INSERT INTO veritapolicy_requirement_status (user_id, lab_id, requirement_id, status, is_na, updated_at) VALUES (?, ?, ?, 'complete', 0, ?)").run(userId, labC, id, now);
    }
    const c = await report(`/api/labs/${labC}/veritapolicy/pdf`, T, labC);
    check("3. a lab with only old-table rows reads as its screen does: 0%", c.score === "0%" && c.cells[1] === "0", `${c.score} complete=${c.cells[1]}`);

    // ── 4. The lab ──────────────────────────────────────────────────────────────────────────────────────────────────
    check("4. the header names the lab and its CLIA", a.html.includes("Made-up Report Lab") && a.html.includes("22D0000771"));
    check("4. the subtitle counts the screen's policies and names its accreditor", a.html.includes(`${summary.total} policies (${summary.ao_label})`), summary.ao_label);
    const b0 = await report(`${B}/pdf`, T, labB);
    check("4. another lab of the same owner has none of these entries", b0.status === 200 && b0.score === "0%" && b0.cells[1] === "0" && !b0.html.includes("Made-up QC Policy") && !b0.html.includes("Made-up Chemical Hygiene Plan") && !b0.html.includes("Made-up Report Lab"), `${b0.score} complete=${b0.cells[1]}`);
    check("4. and its own name, CLIA and no accreditor", b0.html.includes("Made-up Second Lab") && b0.html.includes("22D0000772") && b0.html.includes("CLIA only"));
    await patch(B, labB, r0.policy_id, { status: "complete" });
    const b1 = await report(`${B}/pdf`, T, labB);
    const bSummary = (await call("GET", `${B}/master-list/summary`, undefined, T, labB)).body;
    const a1 = await report(`${A}/pdf`, T, labA);
    check("4. an entry in that lab moves that lab's report and not this one", b1.score === `${bSummary.score}%` && b1.cells[1] === "1" && a1.score === a.score, `B ${b1.score} A ${a1.score}`);
    await patch(A, labA, r1.policy_id, { status: "not_started" });
    const a2 = await report(`${A}/pdf`, T, labA);
    const moved = (await call("GET", `${A}/master-list/summary`, undefined, T, labA)).body;
    check("4. taking an entry back lowers the report", a2.cells[1] === "3" && a2.score === `${moved.score}%` && a2.rows.find((r) => r.id === String(r1.policy_id))?.status === "not_started", `${a2.score} complete=${a2.cells[1]}`);
    await patch(A, labA, r1.policy_id, { status: "complete" });

    const strangerEmail = `dcreport-other-${Date.now()}@example.com`;
    const stranger = (await call("POST", "/api/auth/register", { email: strangerEmail, password: PW, name: "Stranger Madeup", hipaa_acknowledged: true })).body.token as string;
    check("4. someone outside the lab can't pull its report", (await call("POST", `${A}/pdf`, undefined, stranger, labA)).status === 403);

    // ── 5. The route without a lab in the URL ───────────────────────────────────────────────────────────────────────
    const legacy = await report("/api/veritapolicy/pdf", T, labA);
    check("5. it gives the same score and counts", legacy.status === 200 && legacy.score === a.score && legacy.cells.join("|") === a.cells.join("|"), `HTTP ${legacy.status} ${legacy.score} ${legacy.cells.join("|")}`);
    check("5. and the same rows and statuses", JSON.stringify(legacy.rows) === JSON.stringify(a.rows), `${legacy.rows.length} rows`);
    check("5. and the same lab", legacy.html.includes("Made-up Report Lab") && legacy.html.includes("22D0000771"));
    const legacyScreen = (await call("GET", "/api/veritapolicy/master-list", undefined, T, labA)).body;
    const legacySummary = (await call("GET", "/api/veritapolicy/master-list/summary", undefined, T, labA)).body;
    check("5. its screen routes list the custom policy too", legacyScreen.rows?.length === screenRows.length && legacySummary.total === summary.total && legacySummary.score === summary.score, `${legacyScreen.rows?.length} rows, total ${legacySummary.total}`);

    // ── 6. The rest of the page ─────────────────────────────────────────────────────────────────────────────────────
    const page1 = a.html.split('class="page-break"')[0];
    check("6. the review block is on page 1", page1.includes("LABORATORY DIRECTOR OR DESIGNEE REVIEW") && page1.includes("score-num"));
    check("6. page 1 has no full-page height, which printed a blank page 2", !/\.page1\s*\{[^}]*min-height/.test(a.html));
    check("6. the independent-lab setting prints as the screen saved it", /Independent Laboratory<\/td>\s*<td[^>]*>Yes</.test(a.html) && /Independent Laboratory<\/td>\s*<td[^>]*>No</.test(b0.html));
    check("6. settings the screen can't set no longer print", !/Blood Bank \/ Transfusion Service|Transplant Testing|Maternal Serum Marker Screening/.test(page1));
    check("6. the empty policy library page is gone", !a.html.includes("Policy Library Index") && !a.html.includes("No policies in library"));
    check("6. no em dash, hash route or local address in the report", !/—|\/#\/|localhost|127\.0\.0\.1/.test(a.html.replace(/<style>[\s\S]*?<\/style>/, "")));
    const excel = await call("GET", `${A}/master-list/excel`, undefined, T, labA);
    check("6. the Excel master list still downloads", excel.status === 200 && excel.bytes.subarray(0, 2).toString() === "PK", `HTTP ${excel.status}`);

    if (process.env.VERITADC_PDF_OUT) fs.writeFileSync(process.env.VERITADC_PDF_OUT, a.bytes);
  } finally {
    server.close();
    await browser.close().catch(() => {});
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
