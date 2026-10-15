// scripts/repro-calver-pdf.mts
//
// Renders the VeritaCheck PDF for a saved Calibration Verification / Linearity study the way the results page does
// (client/src/pages/StudyResultsPage.tsx: calculateStudy(..., "cal_ver", ...), POST /api/generate-pdf) against a running
// local server, and saves the PDF so its pages can be read. Read-only on the server's database.
// Usage: npx tsx scripts/repro-calver-pdf.mts <baseUrl> <labId> <studyId> <userId> <jwtSecret> <out.pdf>
import fs from "node:fs";
import jwt from "jsonwebtoken";
import { calculateStudy, type DataPoint } from "../client/src/lib/calculations";

const [base, labId, studyId, userId, secret, out] = process.argv.slice(2);
const token = jwt.sign({ userId: Number(userId) }, secret, { expiresIn: "10m" });
const H = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId), "Content-Type": "application/json" };

const r = await fetch(`${base}/api/labs/${labId}/studies/${studyId}`, { headers: H });
if (!r.ok) { console.error("study fetch", r.status, await r.text()); process.exit(2); }
const study: any = await r.json();
if (study.studyType !== "cal_ver") { console.error("not a cal_ver study:", study.studyType); process.exit(2); }
const instrumentNames: string[] = typeof study.instruments === "string" ? JSON.parse(study.instruments) : study.instruments;
const dp: DataPoint[] = typeof study.dataPoints === "string" ? JSON.parse(study.dataPoints) : study.dataPoints;
const results = calculateStudy(dp, instrumentNames, study.cliaAllowableError, "cal_ver", study.teaIsPercentage !== 0, study.cliaAbsoluteFloor ?? null);
console.log("analyzers:", instrumentNames.join(" | "), "| TEa", study.cliaAllowableError, study.teaIsPercentage !== 0 ? "(fraction)" : `(absolute ${study.teaUnit ?? ""})`);
const g = await fetch(`${base}/api/generate-pdf`, { method: "POST", headers: H, body: JSON.stringify({ study, results }) });
if (!g.ok) { console.error("generate-pdf", g.status, await g.text()); process.exit(2); }
const { token: pdfToken } = await g.json();
const pdf = await fetch(`${base}/api/pdf/${pdfToken}`);
fs.writeFileSync(out, Buffer.from(await pdf.arrayBuffer()));
console.log("wrote", out, fs.statSync(out).size, "bytes");
