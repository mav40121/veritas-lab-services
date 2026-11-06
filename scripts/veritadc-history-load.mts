// scripts/veritadc-history-load.mts
//
// Carry a lab's read-and-sign history over from its prior system's report, through POST /api/admin/veritadc/history-load/rows
// (server/veritadcHistoryLoad.ts). Michael 2026-11-06, Q207 = 1: staff don't owe what they already signed in MediaLab.
//
// Dry run (the default): reads the local report and reads production through ADMIN_SECRET GET routes only. It has no code path to a POST.
// It prints counts only. The report has real names, so names go only to the files in the work folder.
//
// Real load: add --apply, and against production --go "<who gave the go, when>". A preflight refuses to start if the routes aren't live or a
// lab name or owner doesn't match. A failure on one row is recorded and the run goes on. Run it again at any time: a row already there is
// recognized and left alone. The load sends no email, assigns no read-and-sign, and creates no login.
//
// How a row is treated:
//   - signed, person on the roster of a lab holding the document: a carried-over signature on that lab's copy.
//   - signed, person inactive in the prior system (in the all-staff report, not the active one): kept as history, linked to nobody, owing nothing.
//   - signed, active person on the other lab's roster only: kept as history on this copy, because this lab's roster doesn't have them.
//   - signed or open, active person the roster can't name exactly: held. They go on a list for a person to look at, never guessed.
//     Fill in employee_id, or "history" under decision, and pass that file back as --people-map.
//   - open: nothing is written. The person owes it when the lab assigns the document, because no signature answers it. Listed for the lab.
//
//   tsx scripts/veritadc-history-load.mts --report <csv> --active-report <csv> --config <json> --work-dir <dir> --confirm-labs 38,39
//     [--people-map <csv>] [--manifest <csv>] [--apply] [--go "..."] [--batch <name>] [--base-url URL] [--batch-size 200] [--pause-ms 50]
//     [--roster-xlsx "38=<xlsx>;39=<xlsx>" --documents-from <document load results csv>]   a dry run before the reference route is deployed
// ADMIN_SECRET comes from the environment and is never printed.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

import { docNumberKey } from "../shared/policyVersion";
import { indexRoster, matchPerson, personKey, priorDate, priorVersionRelation, type PriorPersonState, type RosterPerson } from "../shared/policyPriorSignature";
import { csvCell, parseCsv } from "./veritadc-load-plan.mts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, dflt?: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const need = (name: string) => {
  const v = opt(name);
  if (!v) throw new Error(`--${name} is required`);
  return v;
};
const log = (s: string) => console.log(s);
const lastNameOf = (key: string) => key.split(",")[0].trim();

type Doc = { labId: number; version: string; documentId: number | null };
type Result = {
  number: string; title: string; version: string; loaded_version: string; person: string; credentials: string; lab: number | string;
  employee_id: number | string; person_state: string; assigned_on: string; signed_on: string; result: string; detail: string; document_id: number | string;
};
const COLUMNS: (keyof Result)[] = ["number", "title", "version", "loaded_version", "person", "credentials", "lab", "employee_id", "person_state", "assigned_on", "signed_on", "result", "detail", "document_id"];

async function readRosterXlsx(file: string): Promise<RosterPerson[]> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const out: RosterPerson[] = [];
  let id = 0;
  wb.eachSheet((ws) => {
    let last = 0, first = 0, mi = 0;
    ws.eachRow((row) => {
      const text = (c: number) => String(row.getCell(c).text ?? "").trim();
      if (!last) {
        for (let c = 1; c <= row.cellCount; c++) {
          const h = text(c).toLowerCase();
          if (h.startsWith("last name")) last = c;
          if (h.startsWith("first name")) first = c;
          if (h.startsWith("middle")) mi = c;
        }
        return;
      }
      if (first && text(last) && text(first)) out.push({ id: --id, last_name: text(last), first_name: text(first), middle_initial: mi ? text(mi) : null });
    });
  });
  return out;
}

async function main() {
  const apply = flag("apply");
  const baseUrl = (opt("base-url", "https://www.veritaslabservices.com") as string).replace(/\/$/, "");
  const isProd = /veritaslabservices\.com/.test(baseUrl);
  const batchSize = Number(opt("batch-size", "200"));
  const pauseMs = Number(opt("pause-ms", "50"));
  const reportPath = need("report");
  const activePath = need("active-report");
  const workDir = need("work-dir");
  const config = JSON.parse(fs.readFileSync(need("config"), "utf8")) as { batch: string; sourceSystem: string; loadedBy: string; ownerUserId: number; labs: Record<string, { expectedLabName: string }> };
  const labIds = Object.keys(config.labs).map(Number).sort((a, b) => a - b);
  const confirmed = need("confirm-labs").split(",").map((s) => Number(s.trim())).sort((a, b) => a - b);
  if (confirmed.join() !== labIds.join()) throw new Error(`--confirm-labs ${confirmed.join()} doesn't match the labs in the config (${labIds.join()})`);
  if (apply && isProd && !opt("go")) throw new Error('--apply against production needs --go "<who gave the go, when>"');
  if (apply && !process.env.ADMIN_SECRET) throw new Error("ADMIN_SECRET is not set");
  const batch = opt("batch", `${config.batch}-signoffs`) as string;
  fs.mkdirSync(workDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const mode = apply ? "load" : "dryrun";
  const startedAt = Date.now();

  // ── 1. The report ──
  const rows = parseCsv(fs.readFileSync(reportPath, "utf8"));
  const activeNames = new Set(parseCsv(fs.readFileSync(activePath, "utf8")).map((r) => personKey(r["User"])));
  const manifest = new Map<string, string>();
  if (opt("manifest")) for (const m of parseCsv(fs.readFileSync(opt("manifest") as string, "utf8"))) manifest.set(docNumberKey(m.number), m.status);

  // ── 2. Production, read-only ──
  const secret = process.env.ADMIN_SECRET || "";
  const get = async (p: string) => {
    if (!secret) return { status: 0, body: null as any };
    const r = await fetch(baseUrl + p, { headers: { "x-admin-secret": secret } }).catch(() => null);
    if (!r) return { status: 0, body: null as any };
    let body: any = null;
    try { body = JSON.parse(await r.text()); } catch { /* an HTML page means the route isn't there */ }
    return { status: r.status, body };
  };
  const roster = new Map<number, RosterPerson[]>();
  const documents = new Map<string, Doc[]>();
  const addDoc = (number: string, d: Doc) => {
    const k = docNumberKey(number);
    documents.set(k, [...(documents.get(k) || []), d]);
  };
  const stopReasons: string[] = [];
  const liveLabs: Record<number, boolean> = {};
  for (const id of labIds) {
    const ref = await get(`/api/admin/veritadc/history-load/reference?labId=${id}`);
    liveLabs[id] = ref.status === 200 && Array.isArray(ref.body?.roster);
    if (!liveLabs[id]) continue;
    if (ref.body.labName !== config.labs[String(id)].expectedLabName) stopReasons.push(`lab ${id}: name doesn't match the config`);
    if (ref.body.ownerUserId !== config.ownerUserId) stopReasons.push(`lab ${id}: owner isn't user ${config.ownerUserId}`);
    roster.set(id, ref.body.roster);
    for (const d of ref.body.documents) addDoc(d.number, { labId: id, version: String(d.version), documentId: d.document_id });
  }
  const allLive = labIds.every((id) => liveLabs[id]);
  let referenceSource = "production";
  const fileCheck: Record<string, unknown> = {};
  if (!allLive) {
    if (apply) {
      log("STOP: the reference route isn't live, so the code isn't deployed.");
      throw new Error("Preflight refused the load. Nothing was sent.");
    }
    // A dry run before the route is deployed: the roster files the lab was loaded from, and the document load's own results.
    const rosterArg = opt("roster-xlsx");
    const docsArg = opt("documents-from");
    if (!rosterArg || !docsArg) throw new Error("The reference route isn't live. For a dry run before it is deployed, give --roster-xlsx and --documents-from.");
    referenceSource = "files, because the reference route isn't deployed yet";
    roster.clear();
    documents.clear();
    for (const part of rosterArg.split(";")) {
      const at = part.indexOf("=");
      roster.set(Number(part.slice(0, at)), await readRosterXlsx(part.slice(at + 1)));
    }
    for (const r of parseCsv(fs.readFileSync(docsArg, "utf8"))) {
      if (r.result === "loaded" || r.result === "already_loaded") addDoc(r.number, { labId: Number(r.lab), version: r.version, documentId: r.document_id ? Number(r.document_id) : null });
    }
    // The document numbers are checked against production, which does have a route for them.
    for (const id of labIds) {
      const st = await get(`/api/admin/veritadc/bulk-load/status?labId=${id}`);
      if (st.status !== 200) { fileCheck[`lab${id}`] = "not read"; continue; }
      const live = new Set<string>((st.body.carriedNumbers || []).map((n: string) => docNumberKey(n)));
      const planned = new Set<string>([...documents.entries()].filter(([, ds]) => ds.some((d) => d.labId === id)).map(([k]) => k));
      fileCheck[`lab${id}`] = { documentsOnProduction: live.size, documentsInFile: planned.size, inFileNotOnProduction: [...planned].filter((k) => !live.has(k)).length, onProductionNotInFile: [...live].filter((k) => !planned.has(k)).length };
    }
  }
  if (apply && stopReasons.length) {
    for (const s of stopReasons) log(`STOP: ${s}`);
    throw new Error("Preflight refused the load. Nothing was sent.");
  }

  // ── 3. Who each person is. Exact name or nothing; a person decides the rest ──
  const indexes = new Map<number, Map<string, number[]>>();
  for (const id of labIds) indexes.set(id, indexRoster(roster.get(id) || []));
  type Decision = { kind: "history" } | { kind: "employee"; labId: number; employeeId: number };
  const decided = new Map<string, Decision[]>();
  if (opt("people-map")) {
    for (const m of parseCsv(fs.readFileSync(opt("people-map") as string, "utf8"))) {
      const key = personKey(m.name);
      const decision = String(m.decision || "").trim().toLowerCase();
      if (decision === "history") decided.set(key, [...(decided.get(key) || []), { kind: "history" }]);
      else if (m.employee_id && m.lab_id) decided.set(key, [...(decided.get(key) || []), { kind: "employee", labId: Number(m.lab_id), employeeId: Number(m.employee_id) }]);
    }
  }
  type Person = {
    name: string; key: string; credentials: string; active: boolean;
    kind: "on_roster" | "inactive" | "kept" | "check";
    why: string;
    labs: Map<number, { employeeId: number; confirmed: boolean }>;
    rows: number; signed: number; open: number;
  };
  const people = new Map<string, Person>();
  for (const r of rows) {
    const key = personKey(r["User"]);
    if (!key) continue;
    if (people.has(key)) continue;
    const active = activeNames.has(key);
    const p: Person = { name: String(r["User"]).trim(), key, credentials: String(r["Credentials"] || "").trim(), active, kind: "check", why: "", labs: new Map(), rows: 0, signed: 0, open: 0 };
    const matches = labIds.map((id) => [id, matchPerson(key, indexes.get(id)!)] as const);
    const many = matches.filter(([, m]) => m.kind === "many");
    for (const [id, m] of matches) if (m.kind === "one") p.labs.set(id, { employeeId: m.employeeId, confirmed: false });
    const choices = decided.get(key) || [];
    if (choices.length) {
      p.labs = new Map();
      if (choices.some((c) => c.kind === "history")) p.kind = "kept";
      else {
        for (const c of choices) if (c.kind === "employee") p.labs.set(c.labId, { employeeId: c.employeeId, confirmed: true });
        p.kind = "on_roster";
      }
    } else if (!active) {
      // Never guess: the same name on the roster may be someone else. History either way, and a person gets to look.
      if (p.labs.size || many.length) p.why = "inactive in the prior system, but the same name is on an active roster";
      p.labs = new Map();
      p.kind = "inactive";
    } else if (many.length) {
      p.labs = new Map();
      p.kind = "check";
      p.why = "more than one roster row has this name";
    } else if (p.labs.size) {
      p.kind = "on_roster";
    } else {
      p.kind = "check";
      p.why = "no roster row has exactly this name";
    }
    people.set(key, p);
  }

  // ── 4. Each row ──
  const tally: Record<string, number> = {};
  const bump = (t: Record<string, number>, k: string, by = 1) => { t[k] = (t[k] || 0) + by; };
  const perLab: Record<string, Record<string, number>> = {};
  const bumpLab = (lab: number, k: string) => { perLab[lab] = perLab[lab] || {}; bump(perLab[lab], k); };
  const docsNotLoaded = new Map<string, { number: string; title: string; versions: Set<string>; rows: number; signed: number; open: number }>();
  const openRows: Result[] = [];
  type Send = { labId: number; out: Result; row: any };
  const planned: Send[] = [];
  // Written as it goes, so a stopped run still says what happened to every row it reached.
  const resultsPath = path.join(workDir, `${mode}_results_${stamp}.csv`);
  fs.writeFileSync(resultsPath, "\uFEFF" + COLUMNS.join(",") + "\n");
  let pending: string[] = [];
  const flush = () => { if (pending.length) { fs.appendFileSync(resultsPath, pending.join("\n") + "\n"); pending = []; } };
  const dup = new Set<string>();
  let badDates = 0;
  let minorAboveReport = 0;

  const emit = (out: Result) => {
    pending.push(COLUMNS.map((c) => csvCell(out[c])).join(","));
    if (pending.length >= 500) flush();
    bump(tally, out.result);
    if (typeof out.lab === "number") bumpLab(out.lab, out.result);
  };
  for (const r of rows) {
    const key = personKey(r["User"]);
    if (!key) continue;
    const person = people.get(key)!;
    const number = String(r["Number"] || "").trim();
    const version = String(r["Major Version"] || "").trim();
    const title = String(r["Document Title"] || "").trim();
    const credentials = String(r["Credentials"] || "").trim();
    const assignedOn = priorDate(r["Assigned"]);
    const signedRaw = String(r["Date Signed Off"] || "").trim();
    const signedOn = priorDate(signedRaw);
    const isOpen = !signedOn && /^not signed/i.test(signedRaw);
    person.rows++;
    if (signedOn) person.signed++; else if (isOpen) person.open++;
    const base = (lab: number | string, d: Doc | null, state: string): Result => ({
      number, title, version, loaded_version: d?.version ?? "", person: person.name, credentials, lab, employee_id: "", person_state: state,
      assigned_on: assignedOn ?? "", signed_on: signedOn ?? "", result: "", detail: "", document_id: d?.documentId ?? "",
    });
    if (!signedOn && !isOpen) {
      badDates++;
      emit({ ...base("", null, ""), result: "bad_date", detail: "the signed date isn't a date" });
      continue;
    }
    const placements = documents.get(docNumberKey(number)) || [];
    if (!placements.length) {
      const k = docNumberKey(number);
      const d = docsNotLoaded.get(k) ?? { number, title, versions: new Set<string>(), rows: 0, signed: 0, open: 0 };
      d.versions.add(version); d.rows++; if (signedOn) d.signed++; else d.open++;
      docsNotLoaded.set(k, d);
      emit({ ...base("", null, ""), result: "document_not_loaded", detail: manifest.get(k) ?? "not in the manifest" });
      continue;
    }
    if (person.kind === "check") {
      emit({ ...base("", null, ""), result: signedOn ? "held_person_to_check" : "open_person_to_check", detail: person.why });
      continue;
    }
    if (isOpen) {
      if (person.kind !== "on_roster") { emit({ ...base("", null, person.kind), result: "open_not_owed", detail: "not an active person on the roster" }); continue; }
      const here = placements.filter((d) => person.labs.has(d.labId));
      if (!here.length) { emit({ ...base("", null, "not_on_this_lab_roster"), result: "open_other_lab", detail: "the document isn't in this person's lab" }); continue; }
      for (const d of here) {
        const o: Result = { ...base(d.labId, d, "on_roster"), employee_id: person.labs.get(d.labId)!.employeeId, result: "open_for_lab_to_assign" };
        openRows.push(o);
        emit(o);
      }
      continue;
    }
    // Signed. Which copies get it, and as what.
    const here = person.kind === "on_roster" ? placements.filter((d) => person.labs.has(d.labId)) : [];
    const targets: { d: Doc; state: PriorPersonState; employeeId: number | null; confirmed: boolean }[] = here.length
      ? here.map((d) => ({ d, state: "on_roster" as const, employeeId: person.labs.get(d.labId)!.employeeId, confirmed: person.labs.get(d.labId)!.confirmed }))
      : placements.map((d) => ({
          d,
          state: (person.kind === "inactive" ? "inactive_in_prior_system" : person.kind === "kept" ? "kept_by_a_person" : "not_on_this_lab_roster") as PriorPersonState,
          employeeId: null,
          confirmed: false,
        }));
    for (const t of targets) {
      const relation = priorVersionRelation(version, t.d.version);
      const out: Result = { ...base(t.d.labId, t.d, t.state), employee_id: t.employeeId ?? "" };
      if (relation === "newer" || relation === "bad") { emit({ ...out, result: relation === "newer" ? "version_newer_than_loaded" : "bad_version" }); continue; }
      const seen = `${t.d.labId}|${docNumberKey(number)}|${key}|${version}|${signedOn}|${assignedOn ?? ""}`;
      if (dup.has(seen)) { emit({ ...out, result: "same_row_twice_in_report" }); continue; }
      dup.add(seen);
      const counts = relation === "counts" && t.state === "on_roster";
      if (counts && !String(t.d.version).endsWith(".0")) minorAboveReport++;
      const wouldBe = t.state !== "on_roster" ? `history_${t.state}` : counts ? "signed_counts" : "history_earlier_major";
      out.detail = wouldBe;
      if (apply) {
        planned.push({
          labId: t.d.labId, out,
          row: { docNumber: number, version, personName: person.name, credentials: credentials || null, sourceType: String(r["Type"] || "").trim() || null, assignedOn, signedOn, personState: t.state, employeeId: t.employeeId, confirmedByPerson: t.confirmed },
        });
      } else {
        emit({ ...out, result: `would_load_${wouldBe}` });
      }
    }
  }

  // ── 5. A real load ──
  const outcome: Record<string, number> = {};
  if (apply) {
    for (const id of labIds) {
      const mine = planned.filter((p) => p.labId === id).sort((a, b) => String(a.row.docNumber).localeCompare(String(b.row.docNumber)));
      for (let at = 0; at < mine.length; at += batchSize) {
        const chunk = mine.slice(at, at + batchSize);
        const body = {
          labId: id, expectedLabName: config.labs[String(id)].expectedLabName, ownerUserId: config.ownerUserId,
          sourceSystem: config.sourceSystem, batch, loadedBy: config.loadedBy, rows: chunk.map((c) => c.row),
        };
        let results: any[] | null = null;
        let failure = "";
        for (let attempt = 1; attempt <= 3 && !results; attempt++) {
          try {
            const r = await fetch(`${baseUrl}/api/admin/veritadc/history-load/rows`, { method: "POST", headers: { "x-admin-secret": secret, "Content-Type": "application/json" }, body: JSON.stringify(body) });
            const j: any = await r.json().catch(() => ({}));
            if (r.status === 200) { results = j.results; break; }
            failure = j.code || `HTTP ${r.status}`;
            if (r.status < 500) break;
          } catch (err: any) {
            failure = `network: ${String(err?.code || err?.name || "error")}`;
          }
          if (attempt < 3) await new Promise((ok) => setTimeout(ok, attempt * 5000));
        }
        chunk.forEach((c, i) => {
          const res = results?.[i];
          const result = res?.result ?? "failed";
          bump(outcome, result);
          emit({ ...c.out, result, detail: res?.code ?? (results ? c.out.detail : failure), document_id: res?.documentId ?? c.out.document_id });
        });
        flush();
        log(`lab ${id}: ${Math.min(at + batchSize, mine.length)} of ${mine.length} sent, ${JSON.stringify(outcome)}`);
        if (pauseMs) await new Promise((ok) => setTimeout(ok, pauseMs));
      }
    }
  }

  // ── 6. The files. Names go here and nowhere else ──
  flush();
  const rosterSameLast = (key: string) => {
    const last = lastNameOf(key);
    const hits: string[] = [];
    for (const id of labIds) for (const e of roster.get(id) || []) if (lastNameOf(personKey(`${e.last_name}, ${e.first_name}`)) === last) hits.push(`lab ${id}: ${e.last_name}, ${e.first_name}${e.id > 0 ? ` (employee ${e.id})` : ""}`);
    return hits.join("; ");
  };
  const toCheck = [...people.values()].filter((p) => p.kind === "check" || p.why);
  const checkPath = path.join(workDir, `${mode}_people_to_check_${stamp}.csv`);
  fs.writeFileSync(checkPath, "﻿name,lab_id,employee_id,decision,credentials,why,rows,signed_rows,open_rows,same_last_name_on_a_roster\n" + toCheck.map((p) => [p.name, "", "", "", p.credentials, p.why, p.rows, p.signed, p.open, rosterSameLast(p.key)].map(csvCell).join(",")).join("\n") + "\n");
  const docsPath = path.join(workDir, `${mode}_documents_not_loaded_${stamp}.csv`);
  fs.writeFileSync(docsPath, "﻿number,title,versions,rows,signed_rows,open_rows,manifest_status\n" + [...docsNotLoaded.entries()].map(([k, d]) => [d.number, d.title, [...d.versions].join(" "), d.rows, d.signed, d.open, manifest.get(k) ?? "not in the manifest"].map(csvCell).join(",")).join("\n") + "\n");
  const openPath = path.join(workDir, `${mode}_open_rows_for_the_lab_${stamp}.csv`);
  fs.writeFileSync(openPath, "﻿lab,person,credentials,number,title,version,assigned_on\n" + openRows.map((o) => [o.lab, o.person, o.credentials, o.number, o.title, o.version, o.assigned_on].map(csvCell).join(",")).join("\n") + "\n");

  // ── 7. The summary. Counts only ──
  const allPeople = [...people.values()];
  const matchedPerLab = Object.fromEntries(labIds.map((id) => [id, allPeople.filter((p) => p.kind === "on_roster" && p.labs.has(id)).length]));
  const rosterSizes = Object.fromEntries(labIds.map((id) => [id, (roster.get(id) || []).length]));
  const historyByLab = Object.fromEntries(labIds.map((id) => {
    const ids = new Set(allPeople.flatMap((p) => (p.labs.has(id) ? [p.labs.get(id)!.employeeId] : [])));
    return [id, (roster.get(id) || []).filter((e) => !ids.has(e.id)).length];
  }));
  const documentsPerLab = Object.fromEntries(labIds.map((id) => [id, [...documents.values()].filter((ds) => ds.some((d) => d.labId === id)).length]));
  const inFile = new Set(rows.map((r) => docNumberKey(String(r["Number"] || ""))).filter(Boolean));
  const summary = {
    mode, baseUrl, go: opt("go") ?? null, batch, referenceSource, fileCheck,
    report: {
      rows: rows.length,
      people: people.size,
      documents: inFile.size,
      signed: allPeople.reduce((n, p) => n + p.signed, 0),
      open: allPeople.reduce((n, p) => n + p.open, 0),
      badDates,
    },
    people: {
      activeInPriorSystem: allPeople.filter((p) => p.active).length,
      inactiveInPriorSystem: allPeople.filter((p) => !p.active).length,
      matchedOnARoster: allPeople.filter((p) => p.kind === "on_roster").length,
      matchedPerLab,
      rosterSizes,
      onTheRosterWithNoHistory: historyByLab,
      keptAsHistoryByAPerson: allPeople.filter((p) => p.kind === "kept").length,
      toCheck: toCheck.length,
      toCheckWhy: toCheck.reduce((t, p) => { bump(t, p.why); return t; }, {} as Record<string, number>),
      peopleMapRows: decided.size,
    },
    documents: {
      inReport: inFile.size,
      matched: [...inFile].filter((k) => documents.has(k)).length,
      notLoaded: docsNotLoaded.size,
      rowsOnThoseNotLoaded: [...docsNotLoaded.values()].reduce((t, d) => ({ signed: t.signed + d.signed, open: t.open + d.open }), { signed: 0, open: 0 }),
      loadedPerLab: documentsPerLab,
      loadedWithNoHistory: [...documents.keys()].filter((k) => !inFile.has(k)).length,
      signedRowsWhereTheDocumentCameOverAtAMinorRevision: minorAboveReport,
    },
    rows: { byResult: tally, perLab },
    outcome,
    minutes: Number(((Date.now() - startedAt) / 60000).toFixed(1)),
    files: { results: resultsPath, peopleToCheck: checkPath, documentsNotLoaded: docsPath, openRowsForTheLab: openPath },
  };
  const summaryPath = path.join(workDir, `${mode}_summary_${stamp}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  log(JSON.stringify(summary, null, 2));
  log(`mode ${mode}: ${JSON.stringify(apply ? outcome : tally)}`);
  process.exit(apply && outcome.failed ? 2 : 0);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
