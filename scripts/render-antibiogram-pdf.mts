// scripts/render-antibiogram-pdf.mts
// Renders the VeritaQA antibiogram PDF through the real routes on a SCRATCH database, from a made-up lab, made-up people and the
// mock's made-up totals (parking lot #81; Michael approved the mock 2026-11-23 with the standard review block). Writes the released
// version to OUT and the draft beside it (OUT with _DRAFT before .pdf). Never points at production: it boots the server in-process.
//   DB_PATH=.tmp-abg-render.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy \
//   STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx scripts/render-antibiogram-pdf.mts "<out.pdf>"
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

const OUT = process.argv[2];
if (!OUT || !OUT.endsWith(".pdf")) { console.log('usage: npx tsx scripts/render-antibiogram-pdf.mts "<out.pdf>"'); process.exit(2); }
if (!process.env.DB_PATH || !/\.tmp|scratch/i.test(process.env.DB_PATH)) throw new Error("DB_PATH must be a scratch database (.tmp or scratch in its name).");

const { db } = await import("../server/db");
const { registerRoutes } = await import("../server/routes");
const sqlite = (db as any).$client;
const app = express();
app.use(express.json({ limit: "10mb" }));
const server = http.createServer(app);
await registerRoutes(server, app);
await new Promise<void>((r) => server.listen(0, r));
const addr = server.address();
const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
const call = async (method: string, p: string, body?: unknown, token?: string) => {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r;
};
const stamp = Date.now();
const email = `abg-render-${stamp}@example.com`;
const reg = await (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: "Made Up Director", hipaa_acknowledged: true })).json();
const labId = (await (await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET || "test-admin-secret", ownerEmail: email, labName: "Made-up Stewardship Lab", plan: "hospital" })).json()).labId;
sqlite.prepare("UPDATE labs SET clia_number = ? WHERE id = ?").run(`99D${String(stamp).slice(-7)}`, labId);
const B = `/api/labs/${labId}/veritaqa/stewardship`;
const tok = reg.token as string;

const csv = [
  "Organism,Group,Antimicrobial,Tested,Susceptible",
  ...[
    ["Escherichia coli", 412, [["Ampicillin", 52], ["Ampicillin-sulbactam", 60], ["Piperacillin-tazobactam", 94], ["Cefazolin", 81], ["Ceftriaxone", 88], ["Cefepime", 90], ["Meropenem", 100], ["Gentamicin", 91], ["Ciprofloxacin", 78], ["Trimethoprim-sulfamethoxazole", 74], ["Nitrofurantoin (urine only)", 97]]],
    ["Klebsiella pneumoniae", 133, [["Ampicillin-sulbactam", 82], ["Piperacillin-tazobactam", 92], ["Cefazolin", 86], ["Ceftriaxone", 90], ["Cefepime", 91], ["Meropenem", 99], ["Gentamicin", 95], ["Ciprofloxacin", 89], ["Trimethoprim-sulfamethoxazole", 85], ["Nitrofurantoin (urine only)", 40]]],
    ["Proteus mirabilis", 61, [["Ampicillin", 80], ["Ampicillin-sulbactam", 88], ["Piperacillin-tazobactam", 100], ["Cefazolin", 84], ["Ceftriaxone", 95], ["Cefepime", 97], ["Meropenem", 100], ["Gentamicin", 90], ["Ciprofloxacin", 82], ["Trimethoprim-sulfamethoxazole", 79]]],
    ["Pseudomonas aeruginosa", 74, [["Piperacillin-tazobactam", 88], ["Cefepime", 86], ["Meropenem", 85], ["Gentamicin", 93], ["Ciprofloxacin", 80]]],
    ["Enterobacter cloacae complex", 18, [["Piperacillin-tazobactam", 83], ["Ceftriaxone", 72], ["Cefepime", 94], ["Meropenem", 100], ["Gentamicin", 100], ["Ciprofloxacin", 94], ["Trimethoprim-sulfamethoxazole", 89], ["Nitrofurantoin (urine only)", 50]]],
  ].flatMap(([org, n, drugs]: any) => drugs.map(([d, pct]: any) => `${org},Gram-negative,${d},${n},${Math.round((pct * n) / 100)}`)),
  ...[
    ["Staphylococcus aureus (all)", 188, [["Oxacillin", 58], ["Vancomycin", 100], ["Clindamycin", 79], ["Erythromycin", 42], ["Tetracycline", 93], ["Trimethoprim-sulfamethoxazole", 97], ["Linezolid", 100]]],
    ["Staphylococcus aureus, oxacillin-resistant (MRSA)", 79, [["Vancomycin", 100], ["Clindamycin", 68], ["Erythromycin", 12], ["Tetracycline", 90], ["Trimethoprim-sulfamethoxazole", 95], ["Linezolid", 100]]],
    ["Enterococcus faecalis", 96, [["Vancomycin", 99], ["Linezolid", 100], ["Ampicillin", 100], ["Nitrofurantoin (urine only)", 99]]],
    ["Enterococcus faecium", 11, [["Vancomycin", 36], ["Linezolid", 100], ["Ampicillin", 9], ["Nitrofurantoin (urine only)", 64]]],
  ].flatMap(([org, n, drugs]: any) => drugs.map(([d, pct]: any) => `"${org}",Gram-positive,${d},${n},${Math.round((pct * n) / 100)}`)),
].join("\n");

const id = (await (await call("POST", `${B}/antibiograms`, { title: "2025 antibiogram", period_start: "2025-01-01", period_end: "2025-12-31", source_filter: "All sources (urine-only drugs marked)", data_source: "LIS antibiogram report" }, tok)).json()).id;
const up = await call("POST", `${B}/antibiograms/${id}/upload`, { csv }, tok);
if (!up.ok) throw new Error(`upload ${up.status} ${await up.text()}`);
const draftPdf = await call("GET", `${B}/antibiograms/${id}/pdf`, undefined, tok);
const draftOut = OUT.replace(/\.pdf$/, "_DRAFT.pdf");
fs.writeFileSync(draftOut, Buffer.from(await draftPdf.arrayBuffer()));
const rel = await call("POST", `${B}/antibiograms/${id}/release`, { released_by_name: "Dr. Made Up", released_by_title: "Medical Director" }, tok);
if (!rel.ok) throw new Error(`release ${rel.status}`);
const pdf = await call("GET", `${B}/antibiograms/${id}/pdf`, undefined, tok);
fs.writeFileSync(OUT, Buffer.from(await pdf.arrayBuffer()));
console.log(`released: ${OUT} (${pdf.status}, ${pdf.headers.get("content-disposition")})`);
console.log(`draft: ${draftOut} (${draftPdf.status}, ${draftPdf.headers.get("content-disposition")})`);
server.close();
process.exit(0);
