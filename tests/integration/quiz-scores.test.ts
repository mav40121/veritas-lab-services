// tests/integration/quiz-scores.test.ts
//
// Michael 2026-11-17, Q347 = 1 ("it is difficult to find peoples quiz scores"). Boots the REAL routes on a scratch DB with
// made-up people and proves GET /api/labs/:labId/competency/quiz-scores and its .xlsx:
//   1. list every scored quiz in the lab from all three places: assigned quizzes taken on a staff login (one row per attempt,
//      with its number), a quiz an evaluator gave on a record, and scores typed on Element 6; an Element 6 entry that repeats a
//      result is listed once, and an N/A or blank Element 6 isn't listed
//   2. Pass and Fail as the quiz scored them; a typed Element 6 score reads Pass when marked, else Not marked, never Fail
//   3. carry no answers, no questions and no answer key
//   4. reach: the owner and an editor see everyone; ?staffEmployeeId gives one person; a Staff login sees only their own and
//      is refused anyone else's (403 STAFF_OWN_ONLY); a view-only seat is refused (403 QUIZ_RESULTS_EDIT_ONLY)
//   5. nothing crosses to a sister lab or another customer
//   6. the workbook follows CLAUDE.md section 6 and holds exactly the filtered rows; shared/quizScores.ts filters as the screen does
// Run: npm run test:quiz-scores
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { filterQuizScores, quizScoreChoices, personKey } = await import("../../shared/quizScores");
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
  const day = "2026-10-15";
  const call = async (method: string, path: string, body: unknown, token: string, labHeader?: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (labHeader) headers["X-Active-Lab-Id"] = String(labHeader);
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString("utf8");
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text, buf, type: r.headers.get("content-type") || "", disp: r.headers.get("content-disposition") || "" };
  };
  const register = async (tag: string) => {
    const email = `qs-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = await (await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `QS ${tag}`, hipaa_acknowledged: true }) })).json();
    const id = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id);
    return { email, id, token: reg.token as string };
  };
  const provision = async (email: string, labName: string) => Number((await (await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()).labId);
  const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 0, ?, ?, ?)`
  ).run(lab, userId, role, now, now, now);
  const seat = (ownerId: number, lab: number, u: { id: number; email: string }, type: string, perms: string, rosterId: number | null) => sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
  ).run(ownerId, u.email, u.id, now, now, perms, `qs-${u.id}-${lab}-${type}-${stamp}`, lab, type, rosterId);

  try {
    // ── Fixture: a lab, a sister lab under the same owner, another customer ──
    const OWNER = await register("Owner"), EDITOR = await register("Editor"), VIEWER = await register("Viewer");
    const SAM = await register("Sam"), ZED = await register("Zed"), SISTER_EDITOR = await register("SisterEditor"), OWNER2 = await register("Owner2");
    const labA = await provision(OWNER.email, "Made-up Quiz Lab");
    const labOther = await provision(OWNER2.email, "Made-up Other Customer");
    const labB = Number(sqlite.prepare(
      "INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, created_at, updated_at) SELECT 'Made-up Sister Lab', owner_user_id, plan, subscription_status, subscription_expires_at, ?, ? FROM labs WHERE id = ?"
    ).run(now, now, labA).lastInsertRowid);
    member(labB, OWNER.id, "owner");
    sqlite.prepare("UPDATE labs SET plan = 'hospital', subscription_status = 'active', clia_number = '11D7654392' WHERE id = ?").run(labA);
    sqlite.prepare("UPDATE labs SET plan = 'hospital', subscription_status = 'active' WHERE id = ?").run(labB);
    const L = `/api/labs/${labA}`;
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Quiz Lab", cliaNumber: "11D7654392", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const person = async (last: string, first: string) =>
      Number((await call("POST", `${L}/staff/employees`, { lastName: last, firstName: first, highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    const samId = await person("Retaker", "Sam"), zedId = await person("Quillfeather", "Zed"), noraId = await person("Paperquiz", "Nora");
    member(labA, EDITOR.id); seat(OWNER.id, labA, EDITOR, "active", '{"mode":"edit_all"}', null);
    member(labA, VIEWER.id); seat(OWNER.id, labA, VIEWER, "view_only", '{"mode":"view_all"}', null);
    member(labA, SAM.id); seat(OWNER.id, labA, SAM, "staff_portal", '{"mode":"view_all"}', samId);
    member(labA, ZED.id); seat(OWNER.id, labA, ZED, "staff_portal", '{"mode":"view_all"}', zedId);
    member(labB, SISTER_EDITOR.id); seat(OWNER.id, labB, SISTER_EDITOR, "active", '{"mode":"edit_all"}', null);
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id = ?").run(labB, SISTER_EDITOR.id);

    const mapId = (await call("POST", `${L}/veritamap/maps`, { name: "Core" }, OWNER.token)).j.id;
    const t = (analyte: string) => ({ analyte, specialty: "Chemistry", complexity: "MODERATE", active: 1 });
    await call("POST", `/api/admin/veritamap/seed-map?secret=${ADMIN}`, { mapId, defaultActive: 1, instruments: [
      { name: "Typed Pass Analyzer", category: "Chemistry", tests: [t("Analyte P")] },
      { name: "Typed Unmarked Analyzer", category: "Chemistry", tests: [t("Analyte U")] },
      { name: "Repeat Analyzer", category: "Chemistry", tests: [t("Analyte R")] },
      { name: "Na Analyzer", category: "Chemistry", tests: [t("Analyte N")] },
      { name: "Blank Score Analyzer", category: "Chemistry", tests: [t("Analyte B")] },
    ] }, OWNER.token);
    const instOf = (name: string) => Number((sqlite.prepare("SELECT id FROM veritamap_instruments WHERE instrument_name = ? AND map_id = ?").get(name, mapId) as any)?.id);
    const P = instOf("Typed Pass Analyzer"), U = instOf("Typed Unmarked Analyzer"), R = instOf("Repeat Analyzer"), N = instOf("Na Analyzer"), BL = instOf("Blank Score Analyzer");
    for (const i of [P, U, R, N, BL]) sqlite.prepare("INSERT INTO staff_employee_instruments (employee_id, instrument_id, created_at) VALUES (?, ?, ?)").run(noraId, i, now);

    const prog = (await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry", department: "Chemistry", type: "technical" }, OWNER.token, labA)).j.id;
    const QUESTIONS = [
      { id: "q1", question: "Made-up question one?", options: ["A. first", "B. second", "C. third"], correct_answer: "A", explanation: "Made-up reason one." },
      { id: "q2", question: "Made-up question two?", options: ["A. first", "B. second", "C. third"], correct_answer: "B", explanation: "Made-up reason two." },
      { id: "q3", question: "Made-up question three?", options: ["A. first", "B. second", "C. third"], correct_answer: "C", explanation: "Made-up reason three." },
    ];
    const quizId = Number((await call("POST", `/api/veritacomp/programs/${prog}/quizzes`, { title: "Made-up Chemistry Quiz", questions: QUESTIONS }, OWNER.token, labA)).j.id);
    sqlite.prepare("UPDATE competency_quizzes SET lab_id = ? WHERE id = ?").run(labA, quizId);

    // Assigned quizzes on staff logins: Sam fails attempt 1, passes attempt 2 (a retake); Zed passes.
    await call("POST", `/api/veritacomp/quizzes/${quizId}/assignments`, { staff_employee_ids: [samId, zedId] }, EDITOR.token, labA);
    const take = async (token: string, sid: number, picks: string[], signature: string) => {
      const list = await call("GET", `/api/staff-portal-session/quizzes?employee_id=${sid}`, undefined, token);
      const open = (list.j.quizzes || []).find((q: any) => q.quiz_id === quizId && q.status === "assigned");
      const answers = QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: picks[i] }));
      return open ? call("POST", `/api/staff-portal-session/quizzes/${open.assignment_id}/attempt`, { employee_id: sid, answers, typed_signature: signature }, token) : null;
    };
    const sam1 = await take(SAM.token, samId, ["A", "A", "C"], "Sam Retaker");
    const retake = await call("POST", `/api/veritacomp/quizzes/${quizId}/retake`, { staff_employee_id: samId }, EDITOR.token, labA);
    const sam2 = await take(SAM.token, samId, ["A", "B", "C"], "Sam Retaker");
    const zed1 = await take(ZED.token, zedId, ["A", "B", "C"], "Zed Quillfeather");

    // Nora: a quiz an evaluator gave on her record, and scores typed on Element 6 (one repeats that result).
    const put = (inst: number, el6: any) => call("PUT", `${L}/competency/employee/${noraId}/test-system/${inst}`, { elements: [{ num: 1, specimenId: "S-1" }, { num: 6, ...el6 }] }, OWNER.token, labA);
    const typedPass = await put(P, { quizId: "Paper chemistry quiz", score: 90, dateTaken: day, passed: true });
    await put(U, { quizId: "Outside chemistry quiz", score: 85, dateTaken: "2026-10-20" });
    await put(N, { na: true, naJustification: "Made-up reason for N/A" });
    await put(BL, { quizId: "No score yet" });
    const noraComp = Number((sqlite.prepare("SELECT id FROM competency_employees WHERE staff_employee_id = ? AND lab_id = ?").get(noraId, labA) as any)?.id);
    const given = await call("POST", "/api/veritacomp/quiz-results", { quizId, employeeId: noraComp, answers: QUESTIONS.map((q, i) => ({ question_id: q.id, selected_answer: ["A", "A", "C"][i] })) }, OWNER.token, labA);
    await put(R, { quizId: String(quizId), score: given.j.score, dateTaken: given.j.date_taken });

    // The sister lab and another customer each hold one made-up score of their own.
    const otherScore = (lab: number, ownerId: number, name: string) => {
      const q = Number(sqlite.prepare("INSERT INTO competency_quizzes (user_id, lab_id, title, questions, created_at) VALUES (?, ?, ?, '[]', ?)").run(ownerId, lab, `${name} Quiz`, now).lastInsertRowid);
      const ce = Number(sqlite.prepare("INSERT INTO competency_employees (user_id, lab_id, name, title, created_at) VALUES (?, ?, ?, '', ?)").run(ownerId, lab, `${name} Person`, now).lastInsertRowid);
      sqlite.prepare("INSERT INTO competency_quiz_results (quiz_id, employee_id, answers, score, passed, date_taken, created_at) VALUES (?, ?, '[]', 100, 1, ?, ?)").run(q, ce, day, now);
    };
    otherScore(labB, OWNER.id, "Sister");
    otherScore(labOther, OWNER2.id, "Elsewhere");
    check("0. fixture: attempts taken, a retake, a quiz given on a record, typed Element 6 scores",
      labA > 0 && labB > 0 && labOther > 0 && quizId > 0 && sam1?.s === 200 && retake.s === 200 && sam2?.s === 200 && zed1?.s === 200 && typedPass.s === 200 && given.s === 200 && noraComp > 0,
      `${sam1?.s} ${retake.s} ${sam2?.s} ${zed1?.s} ${typedPass.s} ${typedPass.j.error ?? ""} ${given.s}`);

    // ── 1-3. What the owner sees ─────────────────────────────────────────────
    const url = `${L}/competency/quiz-scores`;
    const own = await call("GET", url, undefined, OWNER.token, labA);
    const rows: any[] = own.j.rows || [];
    const of = (sid: number) => rows.filter((r) => r.staff_employee_id === sid);
    const sam = of(samId).sort((a, b) => a.attempt_no - b.attempt_no);
    check("1a. Sam's two attempts, numbered, from his staff login: 67% Fail then 100% Pass",
      sam.length === 2 && sam.every((r) => r.source === "assigned") && sam[0].attempt_no === 1 && sam[0].score === 67 && sam[0].result === "fail" && sam[1].attempt_no === 2 && sam[1].score === 100 && sam[1].result === "pass" && sam[0].quiz_title === "Made-up Chemistry Quiz",
      JSON.stringify(sam).slice(0, 300));
    check("1b. Zed's attempt", of(zedId).length === 1 && of(zedId)[0].result === "pass" && of(zedId)[0].attempt_no === 1);
    const nora = of(noraId);
    const rec = nora.find((r) => r.source === "record");
    check("1c. the quiz the evaluator gave Nora on a record: no attempt number, 67% Fail", !!rec && rec.attempt_no === null && rec.score === 67 && rec.result === "fail" && rec.quiz_id === quizId, JSON.stringify(rec));
    const typed = nora.filter((r) => r.source === "element6").sort((a, b) => a.score - b.score);
    check("1d. two typed Element 6 scores, named as typed and with the test system they were entered on",
      typed.length === 2 && typed[0].quiz_title === "Outside chemistry quiz" && typed[0].covers === "Typed Unmarked Analyzer" && typed[1].quiz_title === "Paper chemistry quiz" && typed[1].covers === "Typed Pass Analyzer" && typed[1].date_taken === day,
      JSON.stringify(typed));
    check("1e. the Element 6 entry that repeats the evaluator's result is listed once (as the result)", nora.length === 3 && !nora.some((r) => r.source === "element6" && r.covers === "Repeat Analyzer"), nora.map((r) => `${r.source}:${r.covers}`).join(","));
    check("1f. an N/A Element 6 and one with no score aren't listed", !rows.some((r) => r.covers === "Na Analyzer" || r.covers === "Blank Score Analyzer" || r.quiz_title === "No score yet"));
    check("1g. nothing else: 6 rows in all", rows.length === 6 && own.j.own_only === false, `${rows.length}`);
    check("2a. a typed score marked Pass reads Pass; an unmarked one reads Not marked, never Fail", typed[1].result === "pass" && typed[0].result === "not_marked");
    check("2b. newest first (a row's date is never older than the next one's)", rows.every((r, i) => i === 0 || (rows[i - 1].date_taken || "") >= (r.date_taken || "")), rows.map((r) => r.date_taken).join(","));
    check("3a. no answers, questions or answer key in the list", !/selected_answer|correct_answer|Made-up question|Made-up reason|explanation|answers/.test(own.text), own.text.slice(0, 200));

    // ── 4. Reach ──────────────────────────────────────────────────────────────
    const ed = await call("GET", url, undefined, EDITOR.token, labA);
    check("4a. an editor sees the same rows", ed.s === 200 && JSON.stringify(ed.j.rows) === JSON.stringify(rows), `${ed.s}`);
    const one = await call("GET", `${url}?staffEmployeeId=${noraId}`, undefined, EDITOR.token, labA);
    check("4b. ?staffEmployeeId gives one person (the person page)", one.s === 200 && one.j.rows.length === 3 && one.j.rows.every((r: any) => r.staff_employee_id === noraId));
    const samOwn = await call("GET", url, undefined, SAM.token, labA);
    check("4c. a Staff login sees only their own rows, marked own_only", samOwn.s === 200 && samOwn.j.own_only === true && samOwn.j.rows.length === 2 && samOwn.j.rows.every((r: any) => r.staff_employee_id === samId), `${samOwn.s} ${samOwn.j.rows?.length}`);
    const samSelf = await call("GET", `${url}?staffEmployeeId=${samId}`, undefined, SAM.token, labA);
    const samZed = await call("GET", `${url}?staffEmployeeId=${zedId}`, undefined, SAM.token, labA);
    check("4d. asking for their own id works; asking for a coworker is 403 STAFF_OWN_ONLY", samSelf.s === 200 && samSelf.j.rows.length === 2 && samZed.s === 403 && samZed.j.code === "STAFF_OWN_ONLY", `${samSelf.s} ${samZed.s} ${samZed.j.code}`);
    check("4e. the Staff login's list names no coworker", !/Quillfeather|Paperquiz/.test(samOwn.text));
    const view = await call("GET", url, undefined, VIEWER.token, labA);
    check("4f. a view-only seat is refused", view.s === 403 && view.j.code === "QUIZ_RESULTS_EDIT_ONLY", `${view.s} ${view.j.code}`);
    const bad = await call("GET", `${url}?staffEmployeeId=abc`, undefined, EDITOR.token, labA);
    check("4g. a staffEmployeeId that isn't a number is 400", bad.s === 400);

    // ── 5. Sister lab and another customer ───────────────────────────────────
    const sisterIn = await call("GET", url, undefined, SISTER_EDITOR.token, labA);
    check("5a. an editor of the sister lab can't read this lab's list", sisterIn.s === 403 || sisterIn.s === 404, `${sisterIn.s}`);
    const sisterOwn = await call("GET", `/api/labs/${labB}/competency/quiz-scores`, undefined, SISTER_EDITOR.token, labB);
    check("5b. the sister lab's own list holds only its own score", sisterOwn.s === 200 && sisterOwn.j.rows.length === 1 && sisterOwn.j.rows[0].quiz_title === "Sister Quiz", `${sisterOwn.s} ${JSON.stringify(sisterOwn.j).slice(0, 160)}`);
    check("5c. neither the sister lab's nor the other customer's score is in this lab's list", !rows.some((r) => /Sister|Elsewhere/.test(`${r.quiz_title} ${r.person_name}`)));
    const otherIn = await call("GET", url, undefined, OWNER2.token, labA);
    check("5d. another customer's owner is refused", otherIn.s === 403 || otherIn.s === 404, `${otherIn.s}`);

    // ── 6. The workbook ───────────────────────────────────────────────────────
    const { default: ExcelJS } = await import("exceljs");
    const xurl = `${L}/competency/quiz-scores/export.xlsx`;
    const x = await call("GET", xurl, undefined, EDITOR.token, labA);
    check("6a. the download is an .xlsx named for VeritaComp quiz scores", x.s === 200 && /spreadsheetml/.test(x.type) && /VeritaComp_Quiz_Scores_\d{4}-\d{2}-\d{2}\.xlsx/.test(x.disp), `${x.s} ${x.type} ${x.disp}`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.buf);
    const names = wb.worksheets.map((w: any) => w.name);
    const about = wb.getWorksheet("About"), ws = wb.getWorksheet("Quiz Scores");
    check("6b. About first and open, then Quiz Scores", JSON.stringify(names) === JSON.stringify(["About", "Quiz Scores"]) && (wb.views?.[0]?.activeTab ?? 0) === 0, JSON.stringify(names));
    // The license stamp adds its band on row 1 of About, so the identity line is found in column A rather than at a fixed cell.
    const aboutA = (about.getColumn(1).values as any[]).map((v) => String(v ?? ""));
    check("6c. the About sheet names the lab and CLIA, and the info@ address", aboutA.includes("Prepared for: Made-up Quiz Lab    CLIA: 11D7654392")
      && aboutA.some((v) => v.includes("info@veritaslabservices.com")) && aboutA.some((v) => v === "VeritaComp™ Quiz Scores"), aboutA.slice(0, 4).join(" | "));
    const hdrs = [about, ws].flatMap((s: any) => [s.headerFooter?.oddHeader || "", s.headerFooter?.oddFooter || ""]);
    check("6d. every page header and footer carries the lab and CLIA, each within 255 characters", hdrs.every((h) => h.includes("Made-up Quiz Lab") && h.includes("11D7654392") && h.length <= 255), hdrs.map((h) => h.length).join(","));
    check("6e. both sheets protected; frozen at C2; auto-filter on", !!about.sheetProtection && !!ws.sheetProtection && ws.views?.[0]?.topLeftCell === "C2" && !!ws.autoFilter, JSON.stringify({ v: ws.views?.[0], f: ws.autoFilter }));
    const dataRows = ws.getSheetValues().slice(2).filter(Boolean);
    check("6f. one row per score, with its result and how it was recorded", dataRows.length === 6 && dataRows.some((r: any) => r[2] === "Sam Retaker" && r[6] === 2 && r[8] === "Pass" && r[9] === "Assigned quiz") && dataRows.some((r: any) => r[9] === "Entered on Element 6" && r[8] === "Not marked"), JSON.stringify(dataRows[0]));
    const allText = [about, ws].flatMap((s: any) => s.getSheetValues().flat().map((v: any) => String(v ?? ""))).join(" ");
    check("6g. no em dash anywhere in the workbook", !allText.includes("—"));
    const xf = await call("GET", `${xurl}?result=fail`, undefined, EDITOR.token, labA);
    const wf = new ExcelJS.Workbook(); await wf.xlsx.load(xf.buf);
    const failRows = wf.getWorksheet("Quiz Scores").getSheetValues().slice(2).filter(Boolean);
    check("6h. the download holds only the filtered rows (?result=fail: Sam's first attempt and Nora's record)", xf.s === 200 && failRows.length === 2 && failRows.every((r: any) => r[8] === "Fail"), `${failRows.length}`);
    const xs = await call("GET", xurl, undefined, SAM.token, labA);
    const wsam = new ExcelJS.Workbook(); await wsam.xlsx.load(xs.buf);
    const samRows = wsam.getWorksheet("Quiz Scores").getSheetValues().slice(2).filter(Boolean);
    check("6i. a Staff login's download holds only their own rows", xs.s === 200 && samRows.length === 2 && samRows.every((r: any) => r[2] === "Sam Retaker"), `${xs.s} ${samRows.length}`);
    const xv = await call("GET", xurl, undefined, VIEWER.token, labA);
    check("6j. a view-only seat can't download it", xv.s === 403 && xv.j.code === "QUIZ_RESULTS_EDIT_ONLY", `${xv.s}`);

    // ── The shared filter the screen uses ─────────────────────────────────────
    const choices = quizScoreChoices(rows as any);
    check("7a. the person and quiz choices come from the rows", choices.people.length === 3 && choices.quizzes.includes("Made-up Chemistry Quiz") && choices.quizzes.includes("Paper chemistry quiz"));
    check("7b. filters by person, quiz, result and date", filterQuizScores(rows as any, { person: `s${samId}` }).length === 2
      && filterQuizScores(rows as any, { quiz: "Paper chemistry quiz" }).length === 1
      && filterQuizScores(rows as any, { result: "not_marked" }).length === 1
      && filterQuizScores(rows as any, { from: "2026-10-16", to: "2026-10-31" }).every((r: any) => r.date_taken >= "2026-10-16" && r.date_taken <= "2026-10-31")
      && filterQuizScores(rows as any, { from: "2026-10-16", to: "2026-10-31" }).some((r: any) => r.quiz_title === "Outside chemistry quiz")
      && personKey(rows[0] as any).length > 1);
  } catch (e: any) {
    failures++;
    console.log("FAIL  threw: " + (e?.stack || e));
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main();
