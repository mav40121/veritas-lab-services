// Quiz scores (Michael 2026-11-17, Q347 = 1). Every scored quiz in one lab, read from where VeritaComp keeps them:
//   - competency_quiz_results: an assigned quiz a staff member took (source 'staff_portal', tied to its assignment by
//     completed_result_id, which gives the attempt number) and a quiz an evaluator gave on a record (POST
//     /api/veritacomp/quiz-results). Its lab is the assignment's, else the competency employee's, else the quiz's.
//   - competency_assessment_items Element 6: a score typed on a record (a quiz taken outside VeritaComp, or entered by hand),
//     on a record in one of the lab's programs. One that repeats a result above (same person, the quiz's id, the same score
//     and date) is that result and isn't listed twice.
// No answers, no answer key, nothing about the questions: the quiz card's Results keeps those. GET
// /api/labs/:labId/competency/quiz-scores and its .xlsx in routes.ts call these; shared/quizScores.ts filters both.
import { personKey, sortQuizScores, SOURCE_LABEL, RESULT_LABEL, type QuizScoreRow } from "../shared/quizScores";

const nameOf = (first: any, last: any, fallback: any) => `${first || ""} ${last || ""}`.trim() || String(fallback || "").trim() || "Unnamed";

export function quizScoreRows(sqlite: any, labId: number): QuizScoreRow[] {
  const results = sqlite.prepare(
    `SELECT qr.id, qr.quiz_id, qr.score, qr.passed, qr.date_taken, qr.source, qr.voided_at, qr.void_reason,
            COALESCE(qr.staff_employee_id, ce.staff_employee_id) AS staff_employee_id, ce.id AS competency_employee_id,
            ce.name AS ce_name, ce.title AS ce_title, se.first_name, se.last_name, se.title AS se_title,
            q.title AS quiz_title, q.method_group_name, qa.attempt_no
       FROM competency_quiz_results qr
       JOIN competency_quizzes q ON q.id = qr.quiz_id
       LEFT JOIN competency_employees ce ON ce.id = qr.employee_id
       LEFT JOIN staff_employees se ON se.id = COALESCE(qr.staff_employee_id, ce.staff_employee_id)
       LEFT JOIN competency_quiz_assignments qa ON qa.completed_result_id = qr.id
      WHERE COALESCE(qa.lab_id, ce.lab_id, q.lab_id) = ?`
  ).all(labId) as any[];
  const rows: QuizScoreRow[] = results.map((r) => {
    const assigned = r.source === "staff_portal" || r.attempt_no != null;
    return {
      key: `r${r.id}`,
      source: assigned ? "assigned" : "record",
      staff_employee_id: r.staff_employee_id != null ? Number(r.staff_employee_id) : null,
      competency_employee_id: r.competency_employee_id != null ? Number(r.competency_employee_id) : null,
      person_name: nameOf(r.first_name, r.last_name, r.ce_name),
      person_title: (r.se_title || r.ce_title || null) || null,
      quiz_id: Number(r.quiz_id),
      quiz_title: String(r.quiz_title || r.method_group_name || `Quiz ${r.quiz_id}`),
      covers: r.method_group_name || null,
      attempt_no: assigned ? Number(r.attempt_no ?? 1) : null,
      date_taken: r.date_taken || null,
      score: r.score != null ? Number(r.score) : null,
      // A voided attempt (server/quizAttemptVoid.ts) reads Voided whatever it scored.
      result: r.voided_at ? "voided" : Number(r.passed) === 1 ? "pass" : "fail",
      ...(r.voided_at ? { void_reason: r.void_reason ?? null } : {}),
    };
  });

  // The lab's own quizzes by id, to name an Element 6 entry that carries a quiz id.
  const quizTitles = new Map<number, string>();
  for (const q of sqlite.prepare("SELECT id, title, method_group_name FROM competency_quizzes WHERE lab_id = ?").all(labId) as any[]) {
    quizTitles.set(Number(q.id), String(q.title || q.method_group_name || `Quiz ${q.id}`));
  }
  // Each result under both of its person ids, with its date and with "*" (an Element 6 entry with no date matches any).
  const resultKeys = new Set<string>();
  for (const r of rows) {
    for (const who of [r.competency_employee_id != null ? `c${r.competency_employee_id}` : null, r.staff_employee_id != null ? `s${r.staff_employee_id}` : null]) {
      if (!who) continue;
      resultKeys.add(`${who}|${r.quiz_id}|${r.score}|${r.date_taken || ""}`);
      resultKeys.add(`${who}|${r.quiz_id}|${r.score}|*`);
    }
  }
  const items = sqlite.prepare(
    `SELECT i.id, i.el6_quiz_id, i.el6_score, i.el6_date_taken, i.passed, i.method_group_name, i.item_label,
            a.employee_id AS competency_employee_id, ce.name AS ce_name, ce.title AS ce_title, ce.staff_employee_id,
            se.first_name, se.last_name, se.title AS se_title, vi.instrument_name
       FROM competency_assessment_items i
       JOIN competency_assessments a ON a.id = i.assessment_id
       JOIN competency_programs p ON p.id = a.program_id
       JOIN competency_employees ce ON ce.id = a.employee_id
       LEFT JOIN staff_employees se ON se.id = ce.staff_employee_id
       LEFT JOIN veritamap_instruments vi ON vi.id = i.instrument_id
      WHERE p.lab_id = ? AND i.element_number = 6 AND i.el6_score IS NOT NULL AND TRIM(CAST(i.el6_score AS TEXT)) <> ''
        AND COALESCE(i.el6_na, 0) = 0`
  ).all(labId) as any[];
  for (const it of items) {
    const typed = String(it.el6_quiz_id ?? "").trim();
    const asId = /^\d+$/.test(typed) ? Number(typed) : null;
    const score = Number(it.el6_score);
    if (!Number.isFinite(score)) continue;
    const staffId = it.staff_employee_id != null ? Number(it.staff_employee_id) : null;
    const compId = Number(it.competency_employee_id);
    const date = it.el6_date_taken || null;
    // A score filled in from a quiz given on the record is that result: the same person, quiz, score and date.
    if (asId != null && [`c${compId}`, staffId != null ? `s${staffId}` : null]
      .some((who) => who && resultKeys.has(`${who}|${asId}|${score}|${date || "*"}`))) continue;
    rows.push({
      key: `e${it.id}`,
      source: "element6",
      staff_employee_id: staffId,
      competency_employee_id: compId,
      person_name: nameOf(it.first_name, it.last_name, it.ce_name),
      person_title: (it.se_title || it.ce_title || null) || null,
      quiz_id: asId != null && quizTitles.has(asId) ? asId : null,
      quiz_title: asId != null && quizTitles.has(asId) ? quizTitles.get(asId)! : (typed || "Quiz not named"),
      covers: it.instrument_name || it.method_group_name || it.item_label || null,
      attempt_no: null,
      date_taken: date,
      score,
      result: Number(it.passed) === 1 ? "pass" : "not_marked",
    });
  }
  return sortQuizScores(rows);
}

/** Only one person's rows (a Staff login's own, or the person page's), by roster id. */
export function rowsForPerson(rows: QuizScoreRow[], staffEmployeeId: number): QuizScoreRow[] {
  return rows.filter((r) => r.staff_employee_id === staffEmployeeId);
}

export const QUIZ_SCORE_COLUMNS: Array<[string, number]> = [
  ["Date Taken", 12], ["Person", 24], ["Title", 20], ["Quiz", 34], ["Covers", 26],
  ["Attempt", 8], ["Score (%)", 9], ["Result", 11], ["Recorded As", 19],
];

// Header and footer codes treat & as a control character.
const hf = (s: string) => s.replace(/&/g, "&&");

export async function buildQuizScoresWorkbook(
  input: { labName: string; clia: string; today: string; rows: QuizScoreRow[]; filtered: boolean; ownOnly: boolean },
  applyLicense: (wb: any) => void,
): Promise<Buffer> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  wb.creator = "Perplexity Computer";
  wb.created = new Date();
  const { labName, clia, today, rows, filtered, ownOnly } = input;
  const identity = `${labName}    CLIA: ${clia}`;
  const exportPwd = process.env.EXCEL_PROTECT_PASSWORD || "veritaassure-export";
  const border: any = {
    top: { style: "thin", color: { argb: "FFD0D0D0" } },
    bottom: { style: "thin", color: { argb: "FFD0D0D0" } },
    left: { style: "thin", color: { argb: "FFD0D0D0" } },
    right: { style: "thin", color: { argb: "FFD0D0D0" } },
  };
  const header = `&L&"Calibri,Regular"&10VeritaComp Quiz Scores&R&"Calibri,Regular"&10${hf(identity)}`;
  const footer = `&L&"Calibri,Regular"&9${hf(identity)}&C&"Calibri,Regular"&9&P of &N&R&"Calibri,Regular"&9VeritaAssure`;

  // ===== About (sheet 1), written for this workbook =====
  const about = wb.addWorksheet("About");
  about.getColumn(1).width = 110;
  const title = about.getCell("A1");
  title.value = "VeritaComp™ Quiz Scores";
  title.font = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
  title.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  about.getRow(1).height = 30;
  const idCell = about.getCell("A2");
  idCell.value = `Prepared for: ${identity}`;
  idCell.font = { name: "Calibri", bold: true, size: 11, color: { argb: "FF0A3A3D" } };
  idCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
  idCell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
  idCell.border = border;
  about.getRow(2).height = 24;
  let r = 3;
  const section = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", bold: true, size: 12, color: { argb: "FF0A3A3D" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6F2F2" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = border;
    about.getRow(r).height = 22; r += 1;
  };
  const body = (text: string) => {
    const c = about.getCell(`A${r}`);
    c.value = text;
    c.font = { name: "Calibri", size: 11, color: { argb: "FF28251D" } };
    c.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
    c.border = border;
    about.getRow(r).height = Math.max(20, (Math.floor(text.length / 100) + 1) * 16); r += 1;
  };
  const blank = () => { about.getRow(r).height = 8; r += 1; };
  const people = new Set(rows.map(personKey)).size;
  const count = (res: string) => rows.filter((x) => x.result === res).length;
  section("About this workbook");
  body(`The Quiz Scores sheet lists ${ownOnly ? "your" : "every"} scored competency quiz in VeritaComp for this laboratory, one row per attempt, newest first: the date taken, the person, the quiz, what it covers, the attempt number for an assigned quiz, the score and the result. It holds three kinds of score: a quiz assigned to a staff member and taken on their own login, a quiz an evaluator gave on a competency record, and a score typed on a record's Element 6 for a quiz taken outside VeritaComp.`);
  blank();
  section("What this export covers");
  body(`${rows.length} score${rows.length === 1 ? "" : "s"} for ${people} ${people === 1 ? "person" : "people"}: ${count("pass")} Pass, ${count("fail")} Fail, ${count("not_marked")} Not marked${count("voided") ? `, ${count("voided")} Voided` : ""}.${filtered ? " These are the rows the screen's filters showed when the workbook was downloaded." : ""} Exported ${today}.`);
  blank();
  section("How to use this workbook");
  body("Filter Person to see one person's scores, Quiz to see everyone who took one quiz, or Result to find the attempts that need a retake. A VeritaComp quiz passes at 100%. A score typed on Element 6 reads Pass when the element is marked Pass and Not marked otherwise; the evaluator decides it on the record. The answers given on each attempt stay in VeritaComp, under Results on the quiz.");
  blank();
  section("Disclaimer");
  body("This workbook lists what is recorded in VeritaComp. It does not decide anyone's competency; the competency record signed by the evaluator does. VeritaAssure does not certify regulatory compliance and does not advise on whether a given person meets a specific CLIA or accreditation requirement.");
  blank();
  section("Lab identity");
  body(`This workbook was prepared for ${labName} (CLIA ${clia}). The lab name and CLIA appear on every printed page header and footer.`);
  blank();
  section("Coverage gaps");
  body("If your laboratory needs a column or view not represented here, please email info@veritaslabservices.com so it can be evaluated for inclusion in a future revision.");
  about.headerFooter.oddHeader = header;
  about.headerFooter.oddFooter = footer;
  await about.protect(exportPwd, {
    selectLockedCells: false, selectUnlockedCells: false,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: false, pivotTables: false,
  });

  // ===== Quiz Scores =====
  const ws = wb.addWorksheet("Quiz Scores");
  ws.columns = QUIZ_SCORE_COLUMNS.map(([h, w], i) => ({ header: h, key: `c${i}`, width: w }));
  const head = ws.getRow(1);
  head.height = 20;
  head.eachCell((cell) => {
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF01696F" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = border;
  });
  const color: Record<string, string> = { pass: "FF437A22", fail: "FFA12C7B", not_marked: "FF7A7974", voided: "FF7A7974" };
  rows.forEach((row, i) => {
    // A voided attempt's Result cell carries its reason, so the workbook says why as the screen does.
    const resultText = row.result === "voided" && row.void_reason ? `Voided: ${row.void_reason}` : RESULT_LABEL[row.result];
    const out = ws.addRow([
      row.date_taken ?? "", row.person_name, row.person_title ?? "", row.quiz_title, row.covers ?? "",
      row.attempt_no ?? "", row.score ?? "", resultText, SOURCE_LABEL[row.source],
    ]);
    const even = (i + 2) % 2 === 0;
    out.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: "Calibri", size: 10, color: { argb: "FF28251D" } };
      cell.alignment = { vertical: "middle", wrapText: true, ...(col === 6 || col === 7 ? { horizontal: "center" as const } : {}) };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: even ? "FFEBF3F8" : "FFFFFFFF" } };
      cell.border = border;
      if (col === 8) cell.font = { name: "Calibri", bold: true, size: 10, color: { argb: color[row.result] } };
    });
  });
  ws.views = [{ state: "frozen" as const, xSplit: 2, ySplit: 1, topLeftCell: "C2" }];
  ws.autoFilter = { from: "A1", to: ws.getCell(1, QUIZ_SCORE_COLUMNS.length).address };
  ws.pageSetup = {
    paperSize: 1, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1",
    margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
  } as any;
  ws.headerFooter.oddHeader = header;
  ws.headerFooter.oddFooter = footer;
  await ws.protect(exportPwd, {
    selectLockedCells: true, selectUnlockedCells: true,
    formatCells: false, formatColumns: false, formatRows: false,
    insertRows: false, insertColumns: false, insertHyperlinks: false,
    deleteRows: false, deleteColumns: false,
    sort: false, autoFilter: true, pivotTables: false,
  });

  wb.views = [{ x: 0, y: 0, width: 10000, height: 20000, firstSheet: 0, activeTab: 0, visibility: "visible" }];
  applyLicense(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
