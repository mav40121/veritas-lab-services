#!/usr/bin/env node
// verify-competency-bulk-import.js
//
// Regression receipt for Wave I PR I4 (competency bulk-import).
// Confirms four branches of the preview endpoint without committing
// any data:
//
//   A. Template download returns a valid xlsx (Content-Type matches).
//   B. Preview endpoint accepts a multipart upload with a tiny
//      synthesized xlsx and returns { rows, summary }.
//   C. Validation flags an unknown program as an error row.
//   D. Validation flags an unknown employee as an error row.
//
// Run:
//   BASE=https://www.veritaslabservices.com \
//   TOKEN=<JWT for a lab member or owner> \
//   LAB_ID=2 \
//   node scripts/verify-competency-bulk-import.js
//
// Read-only against prod. Does NOT commit.

const BASE = process.env.BASE || "https://www.veritaslabservices.com";
const TOKEN = process.env.TOKEN;
const LAB_ID = Number(process.env.LAB_ID || 0);

if (!TOKEN) { console.error("ERROR: TOKEN env var required"); process.exit(2); }
if (!LAB_ID) { console.error("ERROR: LAB_ID env var required"); process.exit(2); }

const HEADERS_LIST = ["Employee Name", "Program Name", "Assessment Type", "Assessment Date", "Status", "Evaluator Name"];

async function fetchTemplate() {
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/competency/assessments/bulk-template`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  return { status: r.status, contentType: r.headers.get("content-type"), buffer: Buffer.from(await r.arrayBuffer()) };
}

async function buildSyntheticXlsx(rows) {
  // We avoid bundling ExcelJS into this script's dependencies and instead
  // build the workbook via the repo's exceljs dep, called from the same
  // Node process.
  const ExcelJS = require(require.resolve("exceljs", { paths: [process.cwd()] }));
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Assessments");
  sheet.columns = HEADERS_LIST.map((h) => ({ header: h, width: 22 }));
  for (const r of rows) sheet.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function preview(buffer) {
  const fd = new FormData();
  fd.append("file", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "preview.xlsx");
  const r = await fetch(`${BASE}/api/labs/${LAB_ID}/competency/assessments/bulk-preview`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: fd,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

(async () => {
  let pass = 0, fail = 0;

  // Branch A: template
  const tmpl = await fetchTemplate();
  if (tmpl.status === 200 && tmpl.contentType && tmpl.contentType.includes("spreadsheetml") && tmpl.buffer.length > 1000) {
    console.log(`PASS Branch A (template download): ${tmpl.buffer.length} bytes`);
    pass++;
  } else {
    console.error(`FAIL Branch A: status=${tmpl.status} ct=${tmpl.contentType} size=${tmpl.buffer.length}`);
    fail++;
  }

  // Branch B: valid preview (uses a synthetic row referencing a known
  // bogus program / employee so the result is "error" rows, not a crash).
  const syn = await buildSyntheticXlsx([
    ["Smith, John", "definitely-not-a-real-program-name", "annual", "2024-06-15", "pass", "M. Director"],
    ["Doe, Jane", "definitely-not-a-real-program-name", "annual", "2024-06-15", "pass", "M. Director"],
  ]);
  const prev = await preview(syn);
  if (prev.status === 200 && prev.body && Array.isArray(prev.body.rows) && prev.body.summary) {
    console.log(`PASS Branch B (preview shape): ${prev.body.summary.total} row(s), ${prev.body.summary.error} error`);
    pass++;
  } else {
    console.error(`FAIL Branch B: status=${prev.status} body=${JSON.stringify(prev.body).slice(0, 200)}`);
    fail++;
  }

  // Branch C: unknown program flagged
  if (prev.body && prev.body.rows && prev.body.rows.length > 0) {
    const allFlaggedProgram = prev.body.rows.every((r) =>
      r.issues.some((i) => i.field === "Program Name" && i.severity === "error")
    );
    if (allFlaggedProgram) {
      console.log(`PASS Branch C (unknown program flagged): all rows flagged`);
      pass++;
    } else {
      console.error(`FAIL Branch C: not all rows flagged for unknown program`);
      fail++;
    }
  } else {
    console.error(`FAIL Branch C: no rows returned`);
    fail++;
  }

  // Branch D: unknown employee flagged
  if (prev.body && prev.body.rows && prev.body.rows.length > 0) {
    const allFlaggedEmployee = prev.body.rows.every((r) =>
      r.issues.some((i) => i.field === "Employee Name" && i.severity === "error")
    );
    if (allFlaggedEmployee) {
      console.log(`PASS Branch D (unknown employee flagged): all rows flagged`);
      pass++;
    } else {
      console.error(`FAIL Branch D: not all rows flagged for unknown employee`);
      fail++;
    }
  } else {
    console.error(`FAIL Branch D: no rows returned`);
    fail++;
  }

  console.log("");
  console.log(`Summary: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
