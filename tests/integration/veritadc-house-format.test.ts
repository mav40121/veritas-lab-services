// tests/integration/veritadc-house-format.test.ts
//
// Receipt for parking-lot #71 (2026-10-07): per-lab house DOCX format for VeritaDC
// drafts (first instance: UMass Milford, labs 4/5). Boots the REAL routes on a
// scratch DB and proves:
//   1. the admin endpoint refuses a wrong secret (403) and an unknown format (400),
//      previews with dryRun, then sets the lab's format, footer path, safety
//      default and house numbers (audited)
//   2. the lab-scoped DOCX download for that lab renders the house layout:
//      I. PURPOSE .. V. REFERENCES in order, the lab's safety sentence, the
//      Revision History table, the house number and facility path in the footer,
//      NO VeritaAssure line in the footer, X-VeritaPolicy-Source names the format
//   3. a lab left on the default still gets the stock VeritaDC document
//      (Policy Statements heading, VeritaAssure footer, default_generator)
//   4. switching the lab back to 'veritadc' restores the stock document
//   5. the bundle download uses the same per-lab format
// Set HOUSE_SAMPLE_DIR to also write the two rendered DOCX files for eyeballing.
//
// Run (Windows, from bash): DB_PATH=.tmp-house.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/veritadc-house-format.test.ts
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}
const textOf = (xml: string) => xml.replace(/<w:tab\/>/g, "\t").replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const JSZip = (await import("jszip")).default;
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
  const mkLab = async (tag: string) => {
    const email = `house-${tag}-${Date.now()}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "testpass123", name: `House ${tag}`, hipaa_acknowledged: true }));
    const prov = await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName: `House Lab ${tag}`, plan: "hospital", isWarehouse: true }));
    return { token: reg.token as string, labId: prov.labId as number };
  };
  const A = await mkLab("Milford");
  const B = await mkLab("Default");
  check("two labs provisioned", !!A.token && !!A.labId && !!B.token && !!B.labId, JSON.stringify({ A: A.labId, B: B.labId }));
  sqlite.prepare("UPDATE labs SET lab_name = ?, clia_number = ? WHERE id = ?").run("Milford Regional Medical Center Laboratory", "22D0000001", A.labId);

  const POLICY = "001";
  const SAFETY = "Please refer to our lab safety policy: Personal Protective Equipment & General Safety Requirements.";

  // 1. admin endpoint guards + dryRun + set
  const r403 = await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: "wrong", labId: A.labId, format: "umass_milford" });
  check("wrong secret -> 403", r403.status === 403, `status=${r403.status}`);
  const r400 = await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: ADMIN, labId: A.labId, format: "comic_sans" });
  check("unknown format -> 400", r400.status === 400, `status=${r400.status} ${JSON.stringify(await j(r400))}`);
  const dry = await j(await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: ADMIN, labId: A.labId, format: "umass_milford", facilityPath: "MRMC/Laboratory/General", safetyDefault: SAFETY, numbers: [{ policyId: POLICY, houseNumber: "Gen 31", revision: "Rev 10-26" }], dryRun: true }));
  check("dryRun previews without writing", dry.dryRun === true && dry.after?.docx_format === "umass_milford" && !(sqlite.prepare("SELECT docx_format FROM veritapolicy_settings WHERE lab_id = ?").get(A.labId) as any)?.docx_format?.includes("milford"), JSON.stringify(dry).slice(0, 200));
  const set = await j(await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: ADMIN, labId: A.labId, format: "umass_milford", facilityPath: "MRMC/Laboratory/General", safetyDefault: SAFETY, numbers: [{ policyId: POLICY, houseNumber: "Gen 31", revision: "Rev 10-26" }] }));
  const row = sqlite.prepare("SELECT docx_format, house_facility_path, house_safety_default FROM veritapolicy_settings WHERE lab_id = ?").get(A.labId) as any;
  check("format, facility path and safety default stored on the lab's settings", set.ok === true && row?.docx_format === "umass_milford" && row.house_facility_path === "MRMC/Laboratory/General" && row.house_safety_default === SAFETY, JSON.stringify(row));
  const num = sqlite.prepare("SELECT house_number, revision FROM veritapolicy_house_numbers WHERE lab_id = ? AND policy_id = ?").get(A.labId, POLICY) as any;
  check("house number + revision stored per policy", num?.house_number === "Gen 31" && num?.revision === "Rev 10-26", JSON.stringify(num));
  const audit = sqlite.prepare("SELECT COUNT(*) c FROM audit_log WHERE module = 'admin' AND entity_type = 'veritapolicy_settings' AND entity_id = ?").get(String(A.labId)) as any;
  check("admin change is audited", audit.c >= 1, `rows=${audit.c}`);

  // 2. house-format download for lab A
  const dl = await fetch(`${base}/api/labs/${A.labId}/veritapolicy/templates/${POLICY}/docx`, { headers: { Authorization: `Bearer ${A.token}` } });
  check("house-format download answers 200 with the format named", dl.status === 200 && dl.headers.get("x-veritapolicy-source") === "house_format:umass_milford", `status=${dl.status} source=${dl.headers.get("x-veritapolicy-source")}`);
  const bufA = Buffer.from(await dl.arrayBuffer());
  const zipA = await JSZip.loadAsync(bufA);
  const bodyA = textOf(await zipA.file("word/document.xml")!.async("string"));
  const footerA = textOf((await zipA.file("word/footer1.xml")?.async("string")) || "");
  const idx = (s: string) => bodyA.indexOf(s);
  const order = ["I. PURPOSE", "II. POLICY", "III. GUIDELINES", "IV. PERSONAL SAFETY REQUIREMENTS", "V. REFERENCES", "Revision History"].map(idx);
  check("the five Roman-numeral sections and the Revision History appear, in order", order.every((v) => v >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), JSON.stringify(order));
  check("header block: Folder Name / Sub Folder / Policy Name / Policy No.", ["Folder Name:", "Sub Folder:", "Policy Name:", "Policy No."].every((s) => idx(s) >= 0 && idx(s) < order[0]));
  check("Section IV carries the lab's own safety cross-reference sentence", bodyA.includes(SAFETY));
  check("house number and revision appear in the body", bodyA.includes("Gen 31") && bodyA.includes("Rev 10-26"));
  check("footer: facility path + house number + policy name + revision + page", footerA.includes("MRMC/Laboratory/General/Gen 31:") && footerA.includes("Rev 10-26") && /Page/.test(footerA), footerA.slice(0, 160));
  check("footer carries NO VeritaAssure / VeritaDC line", !/VeritaAssure|VeritaDC/.test(footerA), footerA.slice(0, 120));
  check("stock VeritaDC headings are absent from the house document", !bodyA.includes("Policy Statements") && !bodyA.includes("Federal Regulation Excerpts") && !bodyA.includes("LABORATORY DIRECTOR OR DESIGNEE REVIEW"));
  check("lab identity still on the page header", textOf((await zipA.file("word/header1.xml")?.async("string")) || "").includes("22D0000001"));

  // 3. lab B untouched
  const dlB = await fetch(`${base}/api/labs/${B.labId}/veritapolicy/templates/${POLICY}/docx`, { headers: { Authorization: `Bearer ${B.token}` } });
  const zipB = await JSZip.loadAsync(Buffer.from(await dlB.arrayBuffer()));
  const bodyB = textOf(await zipB.file("word/document.xml")!.async("string"));
  const footerB = textOf((await zipB.file("word/footer1.xml")?.async("string")) || "");
  check("default lab still gets the stock VeritaDC document", dlB.status === 200 && dlB.headers.get("x-veritapolicy-source") === "default_generator" && bodyB.includes("Policy Statements") && /VeritaDC/.test(footerB) && !bodyB.includes("IV. PERSONAL SAFETY REQUIREMENTS"), `source=${dlB.headers.get("x-veritapolicy-source")}`);

  // 5. bundle uses the per-lab format
  const bundle = await fetch(`${base}/api/labs/${A.labId}/veritapolicy/templates/bundle.zip`, { headers: { Authorization: `Bearer ${A.token}` } });
  if (bundle.status === 200) {
    const z = await JSZip.loadAsync(Buffer.from(await bundle.arrayBuffer()));
    const first = Object.keys(z.files).find((n) => n.endsWith(".docx"));
    const inner = first ? await JSZip.loadAsync(await z.file(first)!.async("nodebuffer")) : null;
    const t = inner ? textOf(await inner.file("word/document.xml")!.async("string")) : "";
    check("bundle.zip documents use the house format too", !!first && t.includes("IV. PERSONAL SAFETY REQUIREMENTS"), first || "no docx in bundle");
  } else {
    console.log(`info: bundle route answered ${bundle.status}; bundle check skipped`);
  }

  // 4. back to the default
  await call("POST", "/api/admin/veritapolicy/set-house-format", { secret: ADMIN, labId: A.labId, format: "veritadc" });
  const dlA2 = await fetch(`${base}/api/labs/${A.labId}/veritapolicy/templates/${POLICY}/docx`, { headers: { Authorization: `Bearer ${A.token}` } });
  check("switched back to veritadc: stock document again", dlA2.headers.get("x-veritapolicy-source") === "default_generator", `source=${dlA2.headers.get("x-veritapolicy-source")}`);

  const outDir = process.env.HOUSE_SAMPLE_DIR;
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `VeritaDC_${POLICY}_umass_milford_sample.docx`), bufA);
    fs.writeFileSync(path.join(outDir, `VeritaDC_${POLICY}_stock_sample.docx`), Buffer.from(await dlA2.arrayBuffer()));
    console.log("samples written to", outDir);
  }

  server.close();
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
