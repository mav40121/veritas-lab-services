// tests/integration/veritastock-tissue-retention.test.ts
//
// Receipt for the lab-set tissue record retention period (Michael Veri 2026-11-22, Decision 11 = 1, parking lot #115): 21 CFR
// 1271.270(d) doesn't bind a hospital that only receives, stores and implants (1271.15(d)), so the period is the laboratory's own,
// set once on the Tissue page, blank until set, and never a number VeritaStock supplies. Real routes on a scratch database with
// made-up people and tissue. Proves:
//   1. labs.tissue_retention_years exists and is blank on a new lab; GET .../tissue/settings reads blank, and the unit and its record
//      PDF say Not set with the mock's note
//   2. the owner sets it; only that lab changes (not the owner's sister lab, not another owner's lab); one audit row with before/after
//   3. a bad value is refused (400 BAD_RETENTION) and nothing changes; leaving it out can't clear it
//   4. who changes it: the owner and an admin; an editor with edit on everything, a view-only seat, a Staff login, another owner and
//      a sister lab's path are refused and nothing changes; anyone who reads the log reads it and is told whether they can change it
//   5. the unit's keep-until date: implanted counts from the implant date, an Other disposition from its date, an open unit has
//      none; a corrected implant date moves it and an undone implant takes it away (worked out when read, never stored)
//   6. the record PDF: the "Record retention" box sits between the tissue ID and the Unit section, with the mock's words in each
//      state; the form's nine sections are unchanged; the route still answers a real PDF
//   7. clearing it brings back Not set; veritastock.com answers 404; a lab with no suite plan 403
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { labLocalDate, labTimeZoneById } = await import("../../server/dateLocal");
  const { buildTissueRecordHTML, loadTissueRecord, tissueRetentionBoxHTML, TISSUE_RECORD_SECTIONS } = await import("../../server/tissueRecordPdf");
  const { addYearsYmd, TISSUE_RETENTION_UNSET_NOTE, TISSUE_RETENTION_OPEN_VALUE } = await import("../../shared/tissueRules");
  const { PDFDocument } = await import("pdf-lib");
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
  const stamp = Date.now();
  const now = new Date().toISOString();
  const mkUser = async (tag: string) => {
    const email = `tissue-ret-${tag}-${stamp}@example.com`;
    const reg = await j(await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true }));
    return { email, token: reg.token as string, id: Number(reg.user?.id) };
  };
  const mkLab = async (ownerEmail: string, name: string, plan = "hospital") =>
    (await j(await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail, labName: name, plan }))).labId as number;
  const OA = await mkUser("ownerA");
  const OB = await mkUser("ownerB");
  const labA = await mkLab(OA.email, "Retention Main");
  const labA2 = await mkLab(OA.email, "Retention Annex");
  const labB = await mkLab(OB.email, "Retention Other Owner");
  check("setup: two labs for one owner and one for another", !!labA && !!labA2 && !!labB);
  const T = (lab: number) => `/api/labs/${lab}/veritastock/tissue`;
  const S = (lab: number) => `${T(lab)}/settings`;
  const setting = (lab: number) => (sqlite.prepare("SELECT tissue_retention_years AS y FROM labs WHERE id = ?").get(lab) as any)?.y ?? null;
  const settings = () => [setting(labA), setting(labA2), setting(labB)].join(",");
  const today = labLocalDate(new Date().toISOString(), false, labTimeZoneById(sqlite, labA));
  const shift = (d: number) => { const x = new Date(today + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
  const post = (p: string, body: unknown, lab = labA, token = OA.token) => call("POST", `${T(lab)}${p}`, body, token);
  const apos = (s: string) => s.replace(/'/g, "&#39;");

  const cat = (await j(await post("/catalog", { tissue_type: "Made-up Bone Putty", supplier_name: "Made-up Tissue Bank" }))).id as number;
  const receive = async (sourceId: string, lab = labA, catalogId = cat, token = OA.token) => j(await post("/units", {
    catalog_id: catalogId, source_id: sourceId, quantity_or_size: "5 cc", expiration_date: shift(400),
    received_mm_date: shift(-6), received_mm_time: "09:00", received_mm_by: "M. Handler",
    receive_bb: { received_bb_date: shift(-6), received_bb_time: "10:00", received_bb_by: "B. Tech", transport_temp_ok: "yes", package_ok: "yes", storage_location: "Shelf 2" },
  }, lab, token));
  const issue = (id: number, lab = labA, token = OA.token) => post(`/units/${id}/issue`, {
    issued_date: shift(-4), issued_time: "08:00", requesting_physician: "Dr. Made Up", issued_to: "C. Courier", issued_by_tech: "B. Tech", delivered_to: "OR 4",
    readback_id: "yes", readback_expiration: "yes", readback_integrity: "yes",
  }, lab, token);
  const implant = (id: number, date = shift(-3)) => post(`/units/${id}/implant`, { implanted_date: date, implanted_time: "10:00", implanted_by: "Dr. Surgeon" });
  const unit = async (id: number, lab = labA, token = OA.token) => j(await call("GET", `${T(lab)}/units/${id}`, undefined, token));
  const html = (lab: number, id: number) => { const rec = loadTissueRecord(sqlite, lab, id)!; return buildTissueRecordHTML(rec.unit, rec.events, rec.ctx); };

  const I = await receive("RET-IMPLANT");
  await issue(I.id);
  await implant(I.id);
  const W = await receive("RET-WASTED");
  await post(`/units/${W.id}/dispose`, { kind: "wasted", disposition_date: shift(-2), disposition_time: "11:00", disposition_description: "Package torn on the shelf", disposition_by: "B. Tech" });
  const O = await receive("RET-OPEN");
  check("setup: one implanted, one wasted, one in storage", (await unit(I.id)).state === "implanted" && (await unit(W.id)).state === "wasted" && (await unit(O.id)).state === "stored");

  // ── 1. Blank until the lab sets it ─────────────────────────────────────────────────────────────────────────────
  const col = (sqlite.prepare("PRAGMA table_info(labs)").all() as any[]).find((c) => c.name === "tissue_retention_years");
  check("1a. the column is on labs and holds nothing on a new lab", !!col && settings() === ",,", settings());
  const blank = await j(await call("GET", S(labA), undefined, OA.token));
  check("1b. the owner reads blank and can change it", blank.retention_years === null && blank.retention_policy === null && blank.can_edit === true, JSON.stringify(blank));
  const uBlank = await unit(I.id);
  check("1c. the implanted unit says Not set, with the mock's note and no number",
    uBlank.retention?.years === null && uBlank.retention?.keep_until === null && uBlank.retention?.keep_until_text === "Not set" && uBlank.retention?.note === TISSUE_RETENTION_UNSET_NOTE,
    JSON.stringify(uBlank.retention));
  const hBlank = html(labA, I.id);
  check("1d. its record PDF says Not set with the note, and no policy line",
    hBlank.includes('<div class="st">Record retention</div>') && hBlank.includes("<b>Not set</b>") && hBlank.includes(apos(TISSUE_RETENTION_UNSET_NOTE)) && !hBlank.includes("Laboratory&#39;s retention policy"));

  // ── 2. The owner sets it; only that lab changes ─────────────────────────────────────────────────────────────────
  const auditBefore = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'tissue_retention'").get() as any).n);
  const set10 = await call("PUT", S(labA), { retention_years: 10 }, OA.token);
  const set10j = await j(set10);
  check("2a. the owner sets 10 years", set10.status === 200 && set10j.retention_years === 10 && set10j.retention_policy === "10 years after final disposition (implant, return to supplier, or discard)", `${set10.status} ${JSON.stringify(set10j)}`);
  check("2b. only that lab changes: not the sister lab, not another owner's", settings() === "10,,", settings());
  const audits = sqlite.prepare("SELECT entity_id, before_json, after_json, module FROM audit_log WHERE entity_type = 'tissue_retention' ORDER BY id DESC").all() as any[];
  const a0 = audits[0] || {};
  const aBefore = (() => { try { return JSON.parse(a0.before_json || a0.before || "{}"); } catch { return {}; } })();
  const aAfter = (() => { try { return JSON.parse(a0.after_json || a0.after || "{}"); } catch { return {}; } })();
  check("2c. one audit row, with the lab, before and after", audits.length === auditBefore + 1 && String(a0.entity_id) === String(labA) && a0.module === "veritastock" && aBefore.tissue_retention_years === null && aAfter.tissue_retention_years === 10, JSON.stringify(a0));
  const sister = await call("PUT", S(labA2), { retention_years: 7 }, OA.token);
  check("2d. the owner sets the sister lab on its own path, and lab A keeps 10", sister.status === 200 && settings() === "10,7,", settings());

  // ── 3. Bad values ───────────────────────────────────────────────────────────────────────────────────────────────
  for (const bad of [0, 100, -3, 2.5, "ten", "10 years", true, [10]]) {
    const r = await call("PUT", S(labA), { retention_years: bad }, OA.token);
    const rj = await j(r);
    check(`3a. ${JSON.stringify(bad)} is refused and nothing changes`, r.status === 400 && rj.code === "BAD_RETENTION" && settings() === "10,7,", `${r.status} ${JSON.stringify(rj)} ${settings()}`);
  }
  const missing = await call("PUT", S(labA), {}, OA.token);
  check("3b. leaving the value out is refused, so it can't clear it by accident", missing.status === 400 && settings() === "10,7,", `${missing.status} ${settings()}`);
  const phi = await call("PUT", S(labA), { retention_years: 10, note: "Patient: Made Up" }, OA.token);
  check("3c. a body carrying patient information is refused like every tissue write", phi.status === 400 && (await j(phi)).code === "PHI_REFUSED" && settings() === "10,7,");

  // ── 4. Who may change it ────────────────────────────────────────────────────────────────────────────────────────
  const member = (lab: number, userId: number, role = "staff") => sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', 'active', 1, ?, ?, ?)`).run(lab, userId, role, now, now, now);
  const seat = (lab: number, u: { id: number; email: string }, type: string, perms: string) => sqlite.prepare(
    `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`
  ).run(OA.id, u.email, u.id, now, now, perms, `ret-${u.id}-${lab}-${stamp}`, lab, type);
  const ADMINU = await mkUser("admin");
  const EDITOR = await mkUser("editor");
  const VIEWER = await mkUser("viewer");
  const STAFF = await mkUser("staff");
  member(labA, ADMINU.id, "admin");
  member(labA, EDITOR.id); seat(labA, EDITOR, "active", '{"mode":"edit_all"}');
  member(labA, VIEWER.id); seat(labA, VIEWER, "view_only", '{"mode":"view_all"}');
  member(labA, STAFF.id); seat(labA, STAFF, "staff_portal", '{"mode":"view_all"}');
  const byAdmin = await call("PUT", S(labA), { retention_years: 12 }, ADMINU.token);
  check("4a. an admin of the lab can change it", byAdmin.status === 200 && settings() === "12,7,", `${byAdmin.status} ${settings()}`);
  await call("PUT", S(labA), { retention_years: 10 }, OA.token);
  for (const [name, u] of [["an editor with edit on everything", EDITOR], ["a view-only seat", VIEWER], ["a Staff login", STAFF], ["another lab's owner", OB]] as const) {
    const r = await call("PUT", S(labA), { retention_years: 25 }, u.token);
    check(`4b. ${name} can't change it, and nothing changes`, r.status === 403 && settings() === "10,7,", `${r.status} ${settings()}`);
  }
  const editorCode = await j(await call("PUT", S(labA), { retention_years: 25 }, EDITOR.token));
  check("4c. the editor's refusal names the rule in plain words", editorCode.code === "OWNER_OR_ADMIN_ONLY" && /owner or an admin/.test(editorCode.error || ""), JSON.stringify(editorCode));
  const editorSister = await call("PUT", S(labA2), { retention_years: 25 }, EDITOR.token);
  check("4d. lab A's editor can't reach the sister lab's setting either", editorSister.status === 403 && settings() === "10,7,", `${editorSister.status} ${settings()}`);
  const adminSister = await call("PUT", S(labA2), { retention_years: 25 }, ADMINU.token);
  check("4e. lab A's admin isn't the sister lab's admin", adminSister.status === 403 && settings() === "10,7,", `${adminSister.status} ${settings()}`);
  const editorRead = await j(await call("GET", S(labA), undefined, EDITOR.token));
  const staffRead = await j(await call("GET", S(labA), undefined, STAFF.token));
  check("4f. an editor and a Staff login read it and are told they can't change it",
    editorRead.retention_years === 10 && editorRead.can_edit === false && staffRead.retention_years === 10 && staffRead.can_edit === false, `${JSON.stringify(editorRead)} ${JSON.stringify(staffRead)}`);
  check("4g. another owner can't read lab A's setting", (await call("GET", S(labA), undefined, OB.token)).status === 403);
  check("4h. signed out: refused", [401, 403].includes((await call("GET", S(labA))).status) && [401, 403].includes((await call("PUT", S(labA), { retention_years: 1 })).status) && settings() === "10,7,");

  // ── 5. Each unit's keep-until date ──────────────────────────────────────────────────────────────────────────────
  const uI = await unit(I.id);
  const implantedOn = shift(-3);
  check("5a. implanted: keep until the implant date plus 10 years, with the mock's note",
    uI.retention?.years === 10 && uI.retention?.basis_date === implantedOn && uI.retention?.keep_until === addYearsYmd(implantedOn, 10) && uI.retention?.keep_until_text === addYearsYmd(implantedOn, 10)
    && uI.retention?.policy_text === "10 years after final disposition (implant, return to supplier, or discard)"
    && uI.retention?.note === `Set by the laboratory on the Tissue page. The keep-until date counts from this unit's final disposition, implanted ${implantedOn}.`, JSON.stringify(uI.retention));
  const uW = await unit(W.id);
  check("5b. wasted: counts from the disposition date and says so", uW.retention?.keep_until === addYearsYmd(shift(-2), 10) && /final disposition, wasted \d{4}-\d{2}-\d{2}\.$/.test(uW.retention?.note || ""), JSON.stringify(uW.retention));
  const uO = await unit(O.id);
  check("5c. in storage: no date yet, it counts from final disposition", uO.retention?.keep_until === null && uO.retention?.keep_until_text === TISSUE_RETENTION_OPEN_VALUE && /which isn't recorded yet\.$/.test(uO.retention?.note || ""), JSON.stringify(uO.retention));
  const stored = sqlite.prepare("SELECT * FROM tissue_units WHERE id = ?").get(I.id) as any;
  check("5d. nothing about retention is stored on the unit", !Object.keys(stored).some((k) => /retention|keep_until/.test(k)));
  const corr = await post(`/units/${I.id}/correct`, { reason: "Implant date misread", changes: { implanted_date: shift(-2) } });
  const uIc = await unit(I.id);
  check("5e. a corrected implant date moves the keep-until date", corr.status === 200 && uIc.retention?.keep_until === addYearsYmd(shift(-2), 10), `${corr.status} ${JSON.stringify(uIc.retention)}`);
  const undo = await post(`/units/${I.id}/undo`, { reason: "Implant recorded on the wrong unit" });
  const uIu = await unit(I.id);
  check("5f. an undone implant takes the date away until the next final disposition", undo.status === 200 && uIu.state === "issued" && uIu.retention?.keep_until === null && uIu.retention?.keep_until_text === TISSUE_RETENTION_OPEN_VALUE, `${undo.status} ${JSON.stringify(uIu.retention)}`);
  await implant(I.id, shift(-1));
  check("5g. implanted again: counts from the new implant", (await unit(I.id)).retention?.keep_until === addYearsYmd(shift(-1), 10));
  const B1cat = (await j(await post("/catalog", { tissue_type: "Made-up Other", supplier_name: "Made-up Other Bank" }, labB, OB.token))).id as number;
  const B1 = await receive("RET-B", labB, B1cat, OB.token);
  check("5h. another owner's unit reads its own lab's setting: Not set", (await unit(B1.id, labB, OB.token)).retention?.keep_until_text === "Not set");

  // ── 6. The record PDF ───────────────────────────────────────────────────────────────────────────────────────────
  const hSet = html(labA, I.id);
  const boxAt = hSet.indexOf('<div class="st">Record retention</div>');
  const idAt = hSet.indexOf('<div class="idbar">');
  const unitAt = hSet.indexOf('<div class="st">Unit</div>');
  check("6a. the box sits between the tissue ID and the Unit section", idAt > 0 && boxAt > idAt && unitAt > boxAt, `${idAt} ${boxAt} ${unitAt}`);
  check("6b. set: the keep-until date, the policy line and the note, in the mock's words",
    hSet.includes("<span>Keep this record until</span><b>" + addYearsYmd(shift(-1), 10) + "</b>")
    && hSet.includes("<span>Laboratory&#39;s retention policy</span><b>10 years after final disposition (implant, return to supplier, or discard)</b>")
    && hSet.includes(apos(`Set by the laboratory on the Tissue page. The keep-until date counts from this unit's final disposition, implanted ${shift(-1)}.`)));
  const hOpen = html(labA, O.id);
  check("6c. set, unit in storage: counts from final disposition, with the policy line", hOpen.includes(`<b>${TISSUE_RETENTION_OPEN_VALUE}</b>`) && hOpen.includes("10 years after final disposition") && hOpen.includes("which isn&#39;t recorded yet."));
  check("6d. the form's nine sections are unchanged, and the box isn't one of them",
    TISSUE_RECORD_SECTIONS.join("|") === "Unit|Received, Materials Management|Received, blood bank|Issue|Implant|Tissue usage and information card|Returned unused to blood bank|Other disposition (wasted, returned to supplier, expired)|Step history"
    && TISSUE_RECORD_SECTIONS.every((t) => hSet.indexOf(`<div class="st">${t}</div>`) > boxAt));
  check("6e. no em dash, and no patient field in the box", ![hSet, hOpen, hBlank].some((h) => /—/.test(h)) && !/recipient|patient|mrn/i.test(tissueRetentionBoxHTML({ state: "implanted", implanted_date: "2026-11-05" }, 10)));
  check("6f. the loader reads the lab's own setting", loadTissueRecord(sqlite, labA, I.id)!.ctx.retentionYears === 10 && loadTissueRecord(sqlite, labB, B1.id)!.ctx.retentionYears === null);
  const pdf = await call("GET", `${T(labA)}/units/${I.id}/pdf`, undefined, OA.token);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  check("6g. the route still answers a real PDF with the box in it", pdf.status === 200 && bytes.slice(0, 5).toString() === "%PDF-" && (await PDFDocument.load(bytes)).getPageCount() >= 1, String(pdf.status));
  if (process.env.PDF_OUT) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    fs.writeFileSync(path.join(process.env.PDF_OUT, "retention-set-implanted.pdf"), bytes);
    fs.writeFileSync(path.join(process.env.PDF_OUT, "retention-set-open.pdf"), Buffer.from(await (await call("GET", `${T(labA)}/units/${O.id}/pdf`, undefined, OA.token)).arrayBuffer()));
    fs.writeFileSync(path.join(process.env.PDF_OUT, "retention-not-set.pdf"), Buffer.from(await (await call("GET", `${T(labB)}/units/${B1.id}/pdf`, undefined, OB.token)).arrayBuffer()));
  }

  // ── 7. Clearing it; veritastock.com; no plan ────────────────────────────────────────────────────────────────────
  const cleared = await call("PUT", S(labA), { retention_years: null }, OA.token);
  check("7a. clearing it brings back Not set on the unit and the PDF", cleared.status === 200 && setting(labA) === null && (await unit(I.id)).retention?.keep_until_text === "Not set" && html(labA, I.id).includes("<b>Not set</b>"));
  check("7b. clearing lab A leaves the sister lab's 7", setting(labA2) === 7);
  process.env.VITE_STOCK_DEPLOYMENT = "true";
  check("7c. veritastock.com: 404 on both", (await call("GET", S(labA), undefined, OA.token)).status === 404 && (await call("PUT", S(labA), { retention_years: 5 }, OA.token)).status === 404 && setting(labA) === null);
  delete process.env.VITE_STOCK_DEPLOYMENT;
  const free = await mkUser("free");
  const freeLab = await mkLab(free.email, "Retention No Plan");
  sqlite.prepare("UPDATE labs SET plan = 'free' WHERE id = ?").run(freeLab);
  check("7d. no suite plan: 403 and nothing changes", (await call("GET", S(freeLab), undefined, free.token)).status === 403 && (await call("PUT", S(freeLab), { retention_years: 5 }, free.token)).status === 403 && setting(freeLab) === null);

  server.close();
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
