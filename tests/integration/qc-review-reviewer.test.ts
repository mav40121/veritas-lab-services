// tests/integration/qc-review-reviewer.test.ts
//
// BUG-066 (2026-10-16): the VeritaQC monthly period review PDF printed the person DOWNLOADING it as the
// reviewer, dated today, instead of the stored signed review. Pins (real payload builder + real HTML):
//   1. a signed month prints the signer's name and the review date, not the downloader
//   2. the attestation flag comes from the stored review
//   3. an unsigned month prints "Pending signature" with no date
//   4. the PDF route still returns a PDF for the downloader (who is not the reviewer)
// Run: npm run test:qc-review-reviewer

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import jwt from "jsonwebtoken";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { buildMonthlyReviewPayload } from "../../server/qcMonthlyReviewPayload";
import { buildMonthlyReviewHTML } from "../../server/pdfQCMonthly";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const call = async (method: string, p: string, body?: any) => {
    const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const reg = async (tag: string, name: string) => {
    const email = `it-qcrev-${tag}-${Date.now()}@example.com`;
    await call("POST", "/api/auth/register", { email, password: ["Zq", "qc", "7x!"].join("-"), name, hipaa_acknowledged: true });
    return { email, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };
  try {
    const owner = await reg("owner", "Sam Downloader");
    const director = await reg("director", "Dana Director");
    const L = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: owner.email, labName: "IT QC Review", plan: "hospital" })).body.labId);
    const lotId = Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd, status) VALUES (?, 'Glucose', 'L1', 'G-123', 100, 3, 'active')").run(L).lastInsertRowid);
    for (const [d, v] of [["2026-08-03", 99.5], ["2026-08-10", 101.2], ["2026-09-04", 100.4]] as const)
      sqlite.prepare("INSERT INTO qc_results (lab_id, control_lot_id, result_value, result_date, accepted_for_reporting) VALUES (?, ?, ?, ?, 1)").run(L, lotId, v, d);
    sqlite.prepare("INSERT INTO qc_period_reviews (lab_id, control_lot_id, period_month, period_year, reviewed_by_user_id, reviewed_at, attestation_acknowledged) VALUES (?, ?, 8, 2026, ?, '2026-09-02 14:05:00', 1)").run(L, lotId, director.id);
    const lot = sqlite.prepare("SELECT * FROM qc_control_lots WHERE id = ?").get(lotId);
    const lab = sqlite.prepare("SELECT id, lab_name, clia_number FROM labs WHERE id = ?").get(L);

    const aug = buildMonthlyReviewPayload(sqlite, L, lot, lab, 2026, 8);
    const augHtml = buildMonthlyReviewHTML(aug);
    check("1a. a signed month names the signer and the review date", aug.reviewerName === "Dana Director" && aug.reviewerDate === "2026-09-02", `${aug.reviewerName} / ${aug.reviewerDate}`);
    check("1b. the printed review shows the signer, never the downloader", augHtml.includes("Dana Director") && augHtml.includes("2026-09-02") && !augHtml.includes("Sam Downloader"));
    check("2. the attestation flag comes from the stored review", aug.attestationAcknowledged === true);

    const sep = buildMonthlyReviewPayload(sqlite, L, lot, lab, 2026, 9);
    check("3. an unsigned month prints Pending signature with no date", sep.reviewerName === "Pending signature" && sep.reviewerDate === "" && sep.attestationAcknowledged === false, `${sep.reviewerName} / '${sep.reviewerDate}'`);

    const tok = jwt.sign({ svc: true, userId: owner.id }, process.env.JWT_SECRET!, { expiresIn: "10m" });
    const r = await fetch(`${base}/api/labs/${L}/qc/period-reviews/pdf?control_lot_id=${lotId}&year=2026&month=8`, { headers: { Authorization: `Bearer ${tok}`, "X-Active-Lab-Id": String(L) } });
    const ct = r.headers.get("content-type") || "";
    let ok = r.status === 200;
    if (ok && ct.includes("application/json")) { const j: any = await r.json(); ok = !!j.token; }
    else if (ok) { const b = Buffer.from(await r.arrayBuffer()); ok = b.subarray(0, 5).toString() === "%PDF-"; }
    check("4. the PDF route still returns the review PDF to the downloader", ok, `${r.status} ${ct}`);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAIL` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
