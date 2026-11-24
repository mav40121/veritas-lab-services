// tests/integration/competency-pt-picker-lab.test.ts
//
// BUG-189 part 1 (2026-11-24): VeritaComp's "Import from VeritaPT" picker listed PT events by the lab OWNER's user id, so an owner with
// several labs saw other labs' events, and an event with no id and no name imported as "PT event #N". Boots the REAL routes on a scratch
// DB with two made-up labs under one owner and proves:
//   1. each lab's picker lists its own events only
//   2. the sample id is the event id and name that exist, and blank when neither does
//   3. with the person named, an event recorded as tested by someone else is left out, theirs is marked, an unrecorded one stays
//   4. a person in another lab, a program in another lab, and someone outside the lab are refused
//   5. a Staff login reads its own and unrecorded events, and nobody's name
// Run: npm run test:competency-pt-picker-lab
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const ADMIN = process.env.ADMIN_SECRET || "test-admin-secret";
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const stamp = Date.now();
  const now = new Date().toISOString();
  const call = async (method: string, path: string, body: unknown, token?: string) => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (token) h.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const mail = (tag: string) => `ptp-${tag}-${stamp}@example.test`;
  const register = async (tag: string, name: string, inviteToken?: string) => {
    const r = await call("POST", "/api/auth/register", { email: mail(tag), password: "Testpass123", name, hipaa_acknowledged: true, ...(inviteToken ? { inviteToken } : {}) });
    return { token: r.j.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(mail(tag)) as any)?.id), s: r.s };
  };

  try {
    const OWNER = await register("owner", "Made Owner");
    const OUTSIDER = await register("outsider", "Made Outsider");
    const provision = async (labName: string, who = "owner") => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: mail(who), labName, plan: "hospital" })).j.labId);
    const A = await provision("Made-up Picker Lab A"), B = await provision("Made-up Picker Lab B");
    await provision("Made-up Outside Lab", "outsider");

    const staffLabOf = (lab: number) => (sqlite.prepare("SELECT id FROM staff_labs WHERE tier2_lab_id = ?").get(lab) as any)?.id
      ?? Number(sqlite.prepare("INSERT INTO staff_labs (user_id, lab_name, clia_number, tier2_lab_id, created_at, updated_at) VALUES (?, 'Made-up Lab', '22D0000777', ?, ?, ?)").run(OWNER.id, lab, now, now).lastInsertRowid);
    const roster = (first: string, last: string, lab: number) => Number(sqlite.prepare(
      "INSERT INTO staff_employees (lab_id, tier2_lab_id, user_id, last_name, first_name, hire_date, performs_testing, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '2019-03-01', 1, 'active', ?, ?)"
    ).run(staffLabOf(lab), lab, OWNER.id, last, first, now, now).lastInsertRowid);
    const compEmp = (name: string, lab: number, staffId: number | null) => Number(sqlite.prepare(
      "INSERT INTO competency_employees (user_id, name, title, status, created_at, lab_id, staff_employee_id) VALUES (?, ?, 'MLS', 'active', ?, ?, ?)"
    ).run(OWNER.id, name, now, lab, staffId).lastInsertRowid);
    const program = async (lab: number) => Number((await call("POST", `/api/labs/${lab}/competency/programs`, { name: "Made-up Chemistry", department: "Chemistry", type: "technical" }, OWNER.token)).j.id);
    const day = (back: number) => new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
    const event = (lab: number | null, back: number, eventId: string | null, eventName: string | null, tester: number | null = null) => Number(sqlite.prepare(
      "INSERT INTO pt_events (enrollment_id, user_id, event_id, event_name, event_date, analyte, pass_fail, tested_by_employee_id, lab_id) VALUES (0, ?, ?, ?, ?, 'Glucose', 'pass', ?, ?)"
    ).run(OWNER.id, eventId, eventName, day(back), tester, lab).lastInsertRowid);

    const pat = roster("Pat", "Tester", A), kim = roster("Kim", "Other", A);
    const patComp = compEmp("Pat Tester", A, pat), byName = compEmp("Kim Other", A, null), bComp = compEmp("Bee Elsewhere", B, roster("Bee", "Elsewhere", B));
    const pA = await program(A), pB = await program(B);
    const both = event(A, 10, "C-A 2026", "Chemistry Event 1", pat);
    const onlyName = event(A, 11, null, "Chemistry Event 2");
    const onlyId = event(A, 12, "C-C 2026", "  ");
    const same = event(A, 13, "C-D 2026", "C-D 2026");
    const neither = event(A, 14, null, null);
    const kims = event(A, 15, "C-K 2026", "Kim's event", kim);
    const otherLab = event(B, 9, "B-1 2026", "Lab B event");
    const noLab = event(null, 8, "X-1", "No lab on it");

    const pick = async (lab: number, prog: number, token = OWNER.token, q = "") => call("GET", `/api/labs/${lab}/veritacomp/programs/${prog}/pt-samples${q}`, undefined, token);
    const ids = (r: any) => (Array.isArray(r.j) ? r.j.map((e: any) => e.id) : []) as number[];

    // 1. Two labs, one owner.
    const a = await pick(A, pA), b = await pick(B, pB);
    check("1a. lab A's picker lists lab A's events and nothing from lab B or with no lab", a.s === 200 && ids(a).length === 6 && !ids(a).includes(otherLab) && !ids(a).includes(noLab), JSON.stringify({ s: a.s, ids: ids(a), otherLab, noLab }));
    check("1b. lab B's picker lists lab B's event only", b.s === 200 && ids(b).join() === String(otherLab), JSON.stringify(ids(b)));

    // 2. The sample id.
    const sid = (id: number) => a.j.find((e: any) => e.id === id)?.suggestedSampleId;
    check("2a. the event id and name, when both exist", sid(both) === "C-A 2026, Chemistry Event 1", String(sid(both)));
    check("2b. whichever one exists", sid(onlyName) === "Chemistry Event 2" && sid(onlyId) === "C-C 2026", JSON.stringify([sid(onlyName), sid(onlyId)]));
    check("2c. the same text once", sid(same) === "C-D 2026", String(sid(same)));
    check("2d. blank when neither exists, never an event number", sid(neither) === "", String(sid(neither)));
    check("2e. who tested, by name, for an evaluator", a.j.find((e: any) => e.id === kims)?.testedByName === "Other, Kim", JSON.stringify(a.j.find((e: any) => e.id === kims)));

    // 3. The person the record is for.
    const forPat = await pick(A, pA, OWNER.token, `?employeeId=${patComp}`);
    check("3a. an event someone else tested is left out; the rest stay", forPat.s === 200 && !ids(forPat).includes(kims) && ids(forPat).length === 5, JSON.stringify(ids(forPat)));
    check("3b. theirs is marked", forPat.j.find((e: any) => e.id === both)?.testedByThisPerson === true && forPat.j.find((e: any) => e.id === onlyName)?.testedByThisPerson === false);
    const forKim = await pick(A, pA, OWNER.token, `?employeeId=${byName}`);
    check("3c. a record with no roster link is matched by name", ids(forKim).includes(kims) && !ids(forKim).includes(both), JSON.stringify(ids(forKim)));

    // 4. Refusals.
    check("4a. a person in another lab", (await pick(A, pA, OWNER.token, `?employeeId=${bComp}`)).s === 404);
    check("4b. a program in another lab", (await pick(A, pB)).s === 404);
    check("4c. someone outside the lab", (await pick(A, pA, OUTSIDER.token)).s === 403);

    // 5. A Staff login.
    const inv = await call("POST", `/api/labs/${A}/staff-portal-invites`, { staff_employee_id: pat, email: mail("pat"), deliverEmail: false }, OWNER.token);
    const PAT = await register("pat", "Pat Tester", inv.j.inviteToken);
    const staff = await pick(A, pA, PAT.token);
    check("5a. a Staff login never reads an event someone else tested", PAT.s === 200 && staff.s === 200 && !ids(staff).includes(kims) && ids(staff).includes(both), JSON.stringify({ s: staff.s, ids: ids(staff) }));
    check("5b. or anyone's name", staff.s === 200 && staff.j.every((e: any) => e.testedByName === null && e.testedByEmployeeId === null), staff.text.slice(0, 200));
    const asKim = await pick(A, pA, PAT.token, `?employeeId=${byName}`);
    check("5c. naming someone else changes nothing", !ids(asKim).includes(kims) && ids(asKim).join() === ids(staff).join(), JSON.stringify(ids(asKim)));
  } catch (e: any) {
    check("no unexpected error", false, e?.stack || String(e));
  } finally {
    server.close();
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
