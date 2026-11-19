// tests/integration/tjc-safer-esc.test.ts
//
// STANDING integration test for SAFER placement on TJC findings (Lifepoint ask, Michael 2026-11-19):
//   1. An inspection finding keeps the SAFER keys in type_details (likelihood, scope, leadership involvement,
//      preventive analysis); a wrong enum value and unknown keys are dropped; another entry type never keeps them.
//   2. The ESC rule (shared validateTjcEscFields, used by the page checklist and the server gate): placement is
//      required; a Low or Moderate placement needs nothing more; a High one needs leadership involvement and a
//      preventive analysis.
//   3. GET /api/findings/:id/tjc-pdf refuses an unplaced finding and a High one missing the two fields, naming them.
//   4. The ESC HTML prints the placement, and the two High-row sections only when they apply or were written.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:tjc-safer-esc

import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { registerRoutes } from "../../server/routes";
import { db } from "../../server/db";
import { buildTjcEscHTML } from "../../server/pdfReport";
import { validateTjcEscFields, saferPlacement } from "../../shared/findingTypes";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const sqlite = (db as any).$client;
  const PW = ["Sf", "er", "7x!"].join("-");
  const email = `it-safer-${Date.now()}@example.com`;
  let labId = 0;
  let token = "";
  const call = async (method: string, p: string, body?: unknown) => {
    const r = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(labId ? { "X-Active-Lab-Id": String(labId) } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json: any = {}; try { json = await r.json(); } catch {}
    return { status: r.status, body: json };
  };
  const row = (id: number) => sqlite.prepare("SELECT * FROM findings WHERE id = ?").get(id) as any;
  const details = (id: number) => JSON.parse(row(id)?.type_details || "{}");
  const base3 = { description: "Temperature log gaps on the reagent refrigerator", root_cause: "No backup reader on weekends; no patient impact found", corrective_action: "Weekend reader assigned; daily review by the supervisor" };

  try {
    const reg = await call("POST", "/api/auth/register", { email, password: PW, name: "IT Safer Owner", hipaa_acknowledged: true });
    const userId = Number(reg.body?.user?.id);
    labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: process.env.ADMIN_SECRET, ownerEmail: email, labName: "IT Safer Lab", plan: "hospital" })).body?.labId);
    sqlite.prepare("UPDATE labs SET accreditation_tjc = 1 WHERE id = ?").run(labId);
    sqlite.prepare("UPDATE user_sessions SET is_active = 0 WHERE user_id = ?").run(userId);
    token = (await call("POST", "/api/auth/login", { email, password: PW })).body?.token as string;
    check("0. lab made and flagged TJC", labId > 0 && !!token);

    // 1. Storage
    const created = await call("POST", `/api/labs/${labId}/findings`, {
      accreditor: "TJC", anchor_date: "2026-11-02", standard_ref: "QSA.02.01.01 EP 3", ...base3,
      type_details: { safer_likelihood: "high", safer_scope: "everywhere", leadership_involvement: "  CNO and lab director review weekly  ", bogus: "x" },
    });
    const id = Number(created.body?.id);
    const d1 = details(id);
    check("1a. TJC inspection finding created", created.status === 201 && id > 0, JSON.stringify({ s: created.status, e: created.body?.error }));
    check("1b. likelihood and leadership kept (trimmed); bad scope and unknown key dropped", d1.safer_likelihood === "high" && d1.leadership_involvement === "CNO and lab director review weekly" && !("safer_scope" in d1) && !("bogus" in d1), JSON.stringify(d1));
    const put = await call("PUT", `/api/labs/${labId}/findings/${id}`, { ...row(id), type_details: { ...d1, safer_scope: "pattern" } });
    check("1c. a page save sets the scope", put.status === 200 && details(id).safer_scope === "pattern" && details(id).safer_likelihood === "high", JSON.stringify({ s: put.status, d: details(id) }));
    const nce = await call("POST", `/api/labs/${labId}/findings`, { source_type: "internal_nce", description: "Unlabeled tube", event_date: "2026-11-01", type_details: { safer_likelihood: "high", safer_scope: "pattern", nce_phase: "pre_analytic" } });
    const nd = details(Number(nce.body?.id));
    check("1d. an internal event never keeps SAFER keys", nce.status === 201 && !("safer_likelihood" in nd) && !("safer_scope" in nd) && nd.nce_phase === "pre_analytic", JSON.stringify(nd));

    // 2. The ESC rule
    const f = (td: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ ...base3, ...extra, type_details: JSON.stringify(td) });
    const unplaced = validateTjcEscFields(f({}));
    check("2a. no placement: missing only the SAFER placement", !unplaced.ok && unplaced.missing.length === 1 && unplaced.missing[0].startsWith("SAFER placement"), JSON.stringify(unplaced));
    const half = validateTjcEscFields(f({ safer_likelihood: "low" }));
    check("2b. likelihood without scope is not a placement", !half.ok && half.missing[0].startsWith("SAFER placement") && saferPlacement({ safer_likelihood: "low" }) === null, JSON.stringify(half));
    for (const [l, s] of [["low", "limited"], ["low", "widespread"], ["moderate", "pattern"], ["moderate", "widespread"]]) {
      const v = validateTjcEscFields(f({ safer_likelihood: l, safer_scope: s }));
      check(`2c. ${l}/${s} needs nothing more`, v.ok, JSON.stringify(v));
    }
    for (const s of ["limited", "pattern", "widespread"]) {
      const v = validateTjcEscFields(f({ safer_likelihood: "high", safer_scope: s }));
      check(`2d. high/${s} needs leadership involvement and preventive analysis`, !v.ok && v.missing.length === 2 && v.missing[0].startsWith("Leadership involvement") && v.missing[1].startsWith("Preventive analysis"), JSON.stringify(v));
    }
    const highDone = validateTjcEscFields(f({ safer_likelihood: "high", safer_scope: "pattern", leadership_involvement: "x", preventive_analysis: "y" }));
    check("2e. high with both fields passes", highDone.ok, JSON.stringify(highDone));
    const blankLead = validateTjcEscFields(f({ safer_likelihood: "high", safer_scope: "pattern", leadership_involvement: "   ", preventive_analysis: "y" }));
    check("2f. a blank leadership answer still counts as missing", !blankLead.ok && blankLead.missing.length === 1, JSON.stringify(blankLead));
    check("2g. the older three still apply", validateTjcEscFields({ type_details: JSON.stringify({ safer_likelihood: "low", safer_scope: "limited" }) }).missing.length === 3);

    // 3. The PDF gate
    const gateHigh = await call("GET", `/api/findings/${id}/tjc-pdf`);
    check("3a. High/Pattern without preventive analysis is refused, naming it", gateHigh.status === 400 && JSON.stringify(gateHigh.body?.missing) === JSON.stringify(["Preventive analysis (High likelihood to harm)"]), JSON.stringify({ s: gateHigh.status, b: gateHigh.body }));
    const plain = await call("POST", `/api/labs/${labId}/findings`, { accreditor: "TJC", anchor_date: "2026-11-02", ...base3 });
    const gatePlain = await call("GET", `/api/findings/${Number(plain.body?.id)}/tjc-pdf`);
    check("3b. an unplaced TJC finding is refused, naming the placement", gatePlain.status === 400 && (gatePlain.body?.missing || []).some((m: string) => m.startsWith("SAFER placement")), JSON.stringify({ s: gatePlain.status, b: gatePlain.body }));
    // The accreditor gate reads the finding's own lab (before 2026-11-19 it read the user's primary lab, so 3a and 3b
    // got "not flagged as TJC-accredited" for a TJC lab that wasn't the owner's primary one).
    const primary = sqlite.prepare("SELECT lab_id FROM lab_members WHERE user_id = ? AND is_primary_lab = 1 AND status = 'active'").get(userId) as any;
    check("3c. this owner's primary lab is not the TJC lab (the case the gate used to get wrong)", Number(primary?.lab_id ?? 0) !== labId, JSON.stringify(primary));
    sqlite.prepare("UPDATE labs SET accreditation_tjc = 0 WHERE id = ?").run(labId);
    const gateOff = await call("GET", `/api/findings/${id}/tjc-pdf`);
    check("3d. with the finding's lab no longer flagged TJC, the PDF is refused for that reason", gateOff.status === 400 && String(gateOff.body?.error || "").includes("not flagged as TJC-accredited"), JSON.stringify({ s: gateOff.status, b: gateOff.body }));
    sqlite.prepare("UPDATE labs SET accreditation_tjc = 1 WHERE id = ?").run(labId);

    // 4. What the ESC prints
    const user = { lab_name: "IT Safer Lab", clia_number: "22D0000001" };
    const highHtml = buildTjcEscHTML({ finding: { ...row(id), type_details: JSON.stringify({ ...details(id), preventive_analysis: "Checked every refrigerator <b>log</b>" }) }, user } as any);
    check("4a. the placement prints in the header grid", highHtml.includes("SAFER Placement") && highHtml.includes("High / Pattern") && !highHtml.includes("Phase / Severity"));
    check("4b. leadership involvement and preventive analysis print, escaped", highHtml.includes("Leadership Involvement") && highHtml.includes("CNO and lab director review weekly") && highHtml.includes("Preventive Analysis") && highHtml.includes("&lt;b&gt;log&lt;/b&gt;") && !highHtml.includes("<b>log</b>"));
    const lowHtml = buildTjcEscHTML({ finding: { ...base3, id: 9, type_details: JSON.stringify({ safer_likelihood: "low", safer_scope: "limited" }) }, user } as any);
    check("4c. a Low/Limited ESC prints no High-row sections", lowHtml.includes("Low / Limited") && !lowHtml.includes("Leadership Involvement") && !lowHtml.includes("Preventive Analysis"));
    const noneHtml = buildTjcEscHTML({ finding: { ...base3, id: 10 }, user } as any);
    check("4d. an unplaced finding prints 'Not placed'", noneHtml.includes("Not placed"));
    check("4e. no em dash in what the ESC prints", !highHtml.includes("—") && !lowHtml.includes("—"));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
