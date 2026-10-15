// scripts/repro-mc-three-instrument-pdf.mts
//
// Renders the VeritaCheck PDF for a saved method comparison study the way the results page does
// (client/src/pages/StudyResultsPage.tsx: map the primary analyzer to expectedValue, the rest are
// comparisons, calculateMethodComparison, POST /api/generate-pdf) against a running local server,
// and saves the PDF so its pages can be read. Read-only on the server's database.
// Usage: npx tsx scripts/repro-mc-three-instrument-pdf.mts <baseUrl> <labId> <studyId> <userId> <jwtSecret> <out.pdf>
import fs from "node:fs";
import jwt from "jsonwebtoken";
import { calculateMethodComparison, type DataPoint } from "../client/src/lib/calculations";

const [base, labId, studyId, userId, secret, out] = process.argv.slice(2);
const token = jwt.sign({ svc: true, userId: Number(userId) }, secret, { expiresIn: "10m" });
const H = { Authorization: `Bearer ${token}`, "X-Active-Lab-Id": String(labId), "Content-Type": "application/json" };

const r = await fetch(`${base}/api/labs/${labId}/studies/${studyId}`, { headers: H });
if (!r.ok) { console.error("study fetch", r.status, await r.text()); process.exit(2); }
const study: any = await r.json();
const instrumentNames: string[] = typeof study.instruments === "string" ? JSON.parse(study.instruments) : study.instruments;
const dp: DataPoint[] = typeof study.dataPoints === "string" ? JSON.parse(study.dataPoints) : study.dataPoints;
const primaryName = instrumentNames[0];
const comparisonNames = instrumentNames.slice(1);
const mapped: DataPoint[] = dp.map((d: any) => ({
  ...d,
  level: d.level,
  expectedValue: d.instrumentValues[primaryName] ?? null,
  instrumentValues: Object.fromEntries(comparisonNames.map((n) => [n, d.instrumentValues[n] ?? null])),
}));
const results = calculateMethodComparison(mapped, comparisonNames, study.cliaAllowableError, study.teaIsPercentage !== 0, study.cliaAbsoluteFloor ?? null);
console.log("comparisons in results:", Object.keys(results.levelResults[0]?.instruments || {}).join(" | "));
const g = await fetch(`${base}/api/generate-pdf`, { method: "POST", headers: H, body: JSON.stringify({ study, results }) });
if (!g.ok) { console.error("generate-pdf", g.status, await g.text()); process.exit(2); }
const { token: pdfToken } = await g.json();
const pdf = await fetch(`${base}/api/pdf/${pdfToken}`);
fs.writeFileSync(out, Buffer.from(await pdf.arrayBuffer()));
console.log("wrote", out, fs.statSync(out).size, "bytes");
