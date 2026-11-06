// tests/integration/quiz-follows-group.test.ts
//
// REQ-131 (Cathy Thornton, Redington, 2026-11-05): a quiz follows the lab's method group. Her case: PATHFAST goes into a group on the
// Method groups tab, and the quiz's method group option shows it. Boots the REAL routes on a scratch DB with made-up rows.
//   1. Her case, through the tab's real routes: split a group, make it again with the new analyzer, and the row, the quiz form's line and the quiz card show it.
//   2. Nothing is stored: program rows and quizzes stay byte for byte, no row is added, and what a program credits doesn't widen (BUG-043, BUG-120).
//   3. Rename and split read through. After a split the quiz keeps the label it always had.
//   4. Whole names only, inside this lab only, and a one-analyzer leftover or malformed row links nothing.
//   5. The Element 6 picker: every match it made before still wins, in the same order. A group only fills in where it found nothing.
//   6. A Staff login doesn't get the tab's groups, the same as the tab itself.
// Run: npm run test:quiz-follows-group
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
import { findQuizForMethodGroup, labGroupsForRow, quizFollowsLine, quizLabelRowIds, rowGroupNote, rowGroupOthers, type QuizLabel, type QuizGroupRow } from "../../shared/competencyQuizGroups";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { programNamedInstrumentIds } = await import("../../server/competencyMethodClock");
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
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `qfg-${tag}-${stamp}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true })).j;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };

  try {
    const OWNER = await register("owner"), OTHER = await register("other"), STAFF = await register("staff");
    const provision = async (email: string, labName: string) => Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: email, labName, plan: "hospital" })).j.labId);
    const labId = await provision(OWNER.email, "Made-up Quiz Lab"), lab2 = await provision(OTHER.email, "Made-up Other Lab");
    const L = `/api/labs/${labId}`, L2 = `/api/labs/${lab2}`, G = `${L}/competency/method-groups`;
    const instrument = (mapId: number, name: string, category: string) => {
      const id = Number(sqlite.prepare("INSERT INTO veritamap_instruments (map_id, instrument_name, role, category, created_at) VALUES (?, ?, 'Primary', ?, ?)").run(mapId, name, category, now).lastInsertRowid);
      sqlite.prepare("INSERT INTO veritamap_instrument_tests (map_id, instrument_id, analyte, specialty, complexity, active) VALUES (?, ?, ?, 'General', 'MODERATE', 1)").run(mapId, id, `${name} test`);
      return id;
    };
    const mapId = Number((await call("POST", `${L}/veritamap/maps`, { name: "Core" }, OWNER.token)).j.id);
    const chemA = instrument(mapId, "Made-up Chem A", "Chemistry"), chemB = instrument(mapId, "Made-up Chem B", "Chemistry"), chemC = instrument(mapId, "Made-up Chem", "Chemistry");
    const fast = instrument(mapId, "Made-up Fast Kit", "Chemistry"), heme = instrument(mapId, "Made-up Heme", "Hematology");

    const programId = Number((await call("POST", `${L}/competency/programs`, { name: "Made-up Chemistry", department: "Chemistry", type: "technical", methodGroups: [
      { name: "Chemistry - A", instruments: ["Made-up Chem A"], analytes: [] },
      { name: "Chemistry - B", instruments: ["  made-up CHEM b "], analytes: [] },
      { name: "Hematology", instruments: ["Made-up Heme"], analytes: [] },
      { name: "Chemistry - part name", instruments: ["Made-up"], analytes: [] },
    ] }, OWNER.token)).j.id);
    const detailUrl = `${L}/competency/programs/${programId}`;
    const detail = async () => (await call("GET", detailUrl, undefined, OWNER.token)).j;
    const row = (d: any, name: string) => (d.methodGroups || []).find((r: any) => r.name === name);
    const first = await detail();
    const rowA = row(first, "Chemistry - A").id as number, rowB = row(first, "Chemistry - B").id as number, rowH = row(first, "Hematology").id as number;
    const questions = [{ id: "q1", question: "Made-up question?", options: ["A. one", "B. two"], correct_answer: "A", explanation: "" }];
    const quiz = async (title: string, ids: number[], extra: Record<string, unknown> = {}) => Number((await call("POST", `/api/veritacomp/programs/${programId}/quizzes`, {
      title, methodGroupIds: ids, methodGroupId: ids.length === 1 ? ids[0] : null, methodGroupName: null, questions, ...extra,
    }, OWNER.token)).j.id);
    const quizAB = await quiz("Chem quiz", [rowA, rowB]), quizH = await quiz("Heme quiz", [rowH]), quizAll = await quiz("Whole quiz", []);

    const rowsRaw = () => JSON.stringify(sqlite.prepare("SELECT * FROM competency_method_groups WHERE program_id = ? ORDER BY id").all(programId));
    const quizzesRaw = () => JSON.stringify(sqlite.prepare("SELECT * FROM competency_quizzes WHERE program_id = ? ORDER BY id").all(programId));
    const credited = () => JSON.stringify(programNamedInstrumentIds(sqlite, labId).get(programId));
    const eligibleNames = async () => JSON.stringify((await call("GET", `${detailUrl}/eligible-employees`, undefined, OWNER.token)).j.instruments);
    const quizList = async () => (await call("GET", `/api/veritacomp/programs/${programId}/quizzes`, undefined, OWNER.token)).j as any[];
    const rowsBefore = rowsRaw(), quizzesBefore = quizzesRaw(), creditedBefore = credited(), eligibleBefore = await eligibleNames(), listBefore = JSON.stringify(await quizList());
    const followsOf = (q: QuizLabel, d: any) => quizFollowsLine(q, d.methodGroups as QuizGroupRow[]);
    const stored = (id: number) => (quizList().then((l) => l.find((q) => q.id === id)));

    check("setup: a program with labeled quizzes", !!rowA && !!rowB && !!rowH && !!quizAB && !!quizH && !!quizAll);
    check("before any group: no row is in one", (first.methodGroups as any[]).every((r) => Array.isArray(r.labGroups) && r.labGroups.length === 0));
    check("before any group: the form shows no line", (first.methodGroups as any[]).every((r) => rowGroupNote(r) === null));
    check("before any group: the card shows no line", followsOf(await stored(quizAB), first) === null);

    // 1. Her case. The tab has no add-an-analyzer control, so adding one is split, then make the group again.
    const made = await call("POST", G, { name: "Chem analyzers", instrumentIds: [chemA, chemB] }, OWNER.token);
    check("the group is made on the tab", made.s === 200, `HTTP ${made.s} ${made.j.error ?? ""}`);
    let d = await detail();
    check("each named analyzer's row is in the group", row(d, "Chemistry - A").labGroups[0]?.name === "Chem analyzers" && row(d, "Chemistry - B").labGroups[0]?.name === "Chem analyzers", JSON.stringify(row(d, "Chemistry - B").labGroups));
    check("the other row isn't", row(d, "Hematology").labGroups.length === 0);
    check("the form's line names the group and the other analyzer", rowGroupNote(row(d, "Chemistry - A")) === `In group "Chem analyzers" with Made-up Chem B`, String(rowGroupNote(row(d, "Chemistry - A"))));
    check("a row naming the whole group shows the group with no one else", rowGroupNote({ id: 1, instruments: JSON.stringify(["Made-up Chem A", "Made-up Chem B"]), labGroups: row(d, "Chemistry - A").labGroups }) === `In group "Chem analyzers"`);
    check("the fast kit isn't shown yet", !JSON.stringify(row(d, "Chemistry - A").labGroups).includes("Made-up Fast Kit"));

    check("split the group", (await call("DELETE", `${G}/${made.j.groupId}`, undefined, OWNER.token)).s === 200);
    const again = await call("POST", G, { name: "Chem analyzers", instrumentIds: [chemA, chemB, fast] }, OWNER.token);
    check("make it again with the fast kit", again.s === 200, `HTTP ${again.s} ${again.j.error ?? ""}`);
    d = await detail();
    check("Cathy's case: the row's group now holds the fast kit", row(d, "Chemistry - A").labGroups[0]?.members.includes("Made-up Fast Kit"), JSON.stringify(row(d, "Chemistry - A").labGroups));
    check("Cathy's case: the quiz form shows it", rowGroupNote(row(d, "Chemistry - A")) === `In group "Chem analyzers" with Made-up Chem B, Made-up Fast Kit`, String(rowGroupNote(row(d, "Chemistry - A"))));
    check("Cathy's case: so does a row with different spacing and case", rowGroupNote(row(d, "Chemistry - B")) === `In group "Chem analyzers" with Made-up Chem A, Made-up Fast Kit`, String(rowGroupNote(row(d, "Chemistry - B"))));
    check("Cathy's case: the question's choice shows it", rowGroupOthers(row(d, "Chemistry - A")).join() === "Made-up Chem B,Made-up Fast Kit");
    check("Cathy's case: the quiz card shows it", followsOf(await stored(quizAB), d) === `Follows method group "Chem analyzers": Made-up Chem A, Made-up Chem B, Made-up Fast Kit`, String(followsOf(await stored(quizAB), d)));
    check("a quiz on another group shows nothing new", followsOf(await stored(quizH), d) === null);
    check("a quiz with no label shows nothing new", followsOf(await stored(quizAll), d) === null);
    const older = (await call("GET", `/api/competency/programs/${programId}`, undefined, OWNER.token)).j;
    check("the older program route says the same", row(older, "Chemistry - A")?.labGroups?.[0]?.members.includes("Made-up Fast Kit"), JSON.stringify(row(older, "Chemistry - A")?.labGroups));

    // 2. Nothing stored
    check("the program's rows are byte for byte the same, and none was added", rowsRaw() === rowsBefore);
    check("the quizzes are byte for byte the same", quizzesRaw() === quizzesBefore);
    check("the quiz list reads the same", JSON.stringify(await quizList()) === listBefore);
    check("what the program credits didn't widen to the fast kit", credited() === creditedBefore && !JSON.parse(credited()).includes(fast), credited());
    check("who it lists as eligible didn't widen either", (await eligibleNames()) === eligibleBefore);

    // 3. Rename and split
    check("rename on the tab", (await call("PUT", `${G}/${again.j.groupId}`, { name: "Renamed chem" }, OWNER.token)).s === 200);
    d = await detail();
    check("the form and the card take the new name", rowGroupNote(row(d, "Chemistry - A"))!.startsWith(`In group "Renamed chem"`) && followsOf(await stored(quizAB), d)!.startsWith(`Follows method group "Renamed chem"`));
    check("split on the tab", (await call("DELETE", `${G}/${again.j.groupId}`, undefined, OWNER.token)).s === 200);
    d = await detail();
    check("after a split the rows are in no group", (d.methodGroups as any[]).every((r) => r.labGroups.length === 0));
    check("after a split the card line is gone", followsOf(await stored(quizAB), d) === null);
    check("after a split the quiz still has the rows it was labeled with", JSON.stringify(quizLabelRowIds(await stored(quizAB))) === JSON.stringify([rowA, rowB]) && quizzesRaw() === quizzesBefore);
    check("after a split the rows are still the same", rowsRaw() === rowsBefore);

    // 4. Whole names, this lab
    const third = await call("POST", G, { name: "Back again", instrumentIds: [chemA, chemC] }, OWNER.token);
    d = await detail();
    check("a row naming part of an analyzer's name isn't in its group", third.s === 200 && row(d, "Chemistry - part name").labGroups.length === 0, JSON.stringify(row(d, "Chemistry - part name").labGroups));
    check("nor one the group's member name is a part of", row(d, "Chemistry - B").labGroups.length === 0, JSON.stringify(row(d, "Chemistry - B").labGroups));
    const map2 = Number((await call("POST", `${L2}/veritamap/maps`, { name: "Elsewhere" }, OTHER.token)).j.id);
    const twinA = instrument(map2, "Made-up Heme", "Hematology"), twinB = instrument(map2, "Made-up Elsewhere", "Hematology");
    const otherGroup = await call("POST", `${L2}/competency/method-groups`, { name: "Another lab's group", instrumentIds: [twinA, twinB] }, OTHER.token);
    d = await detail();
    check("another lab's group with a same-named analyzer doesn't reach this lab", otherGroup.s === 200 && row(d, "Hematology").labGroups.length === 0, JSON.stringify(row(d, "Hematology").labGroups));
    const lone = Number(sqlite.prepare("INSERT INTO competency_instrument_groups (lab_id, name, created_at, updated_at) VALUES (?, 'Left with one', ?, ?)").run(labId, now, now).lastInsertRowid);
    sqlite.prepare("INSERT INTO competency_instrument_group_members (group_id, lab_id, instrument_id, created_at) VALUES (?, ?, ?, ?)").run(lone, labId, heme, now);
    d = await detail();
    check("a leftover group of one is no group, as on the tab", row(d, "Hematology").labGroups.length === 0, JSON.stringify(row(d, "Hematology").labGroups));
    check("malformed instruments name nothing and don't throw", labGroupsForRow("{not json", [{ id: 1, name: "G", members: ["X"] }]).length === 0 && rowGroupNote({ id: 1, instruments: "{not json", labGroups: [{ id: 1, name: "G", members: ["X"] }] }) === `In group "G" with X`);
    check("a quiz with a malformed list falls to its single id", JSON.stringify(quizLabelRowIds({ method_group_ids: "{bad", method_group_id: 7 })) === "[7]");
    sqlite.prepare("INSERT INTO competency_method_groups (program_id, name, instruments, analytes) VALUES (?, 'Bad row', '{not json', '[]')").run(programId);
    const withBad = await call("GET", detailUrl, undefined, OWNER.token);
    check("a malformed row doesn't break the program", withBad.s === 200 && row(withBad.j, "Bad row")?.labGroups?.length === 0, `HTTP ${withBad.s}`);
    sqlite.prepare("DELETE FROM competency_method_groups WHERE program_id = ? AND name = 'Bad row'").run(programId);

    // 5. The Element 6 picker
    const G1 = { id: 1, name: "G1", members: ["A", "B", "Fast"] }, G2 = { id: 2, name: "G2", members: ["C", "D"] };
    const r = (id: number, name: string, ...labGroups: Array<typeof G1>): QuizGroupRow => ({ id, name, instruments: "[]", labGroups });
    const rows = [r(10, "Row A", G1), r(11, "Row B", G1), r(12, "Row Fast", G1), r(13, "Row C", G2), r(14, "Row plain")];
    const q = (id: number, label: QuizLabel) => ({ id, ...label });
    const pick = (quizzes: Array<{ id: number } & QuizLabel>, id: number) => findQuizForMethodGroup(quizzes, rows.find((x) => x.id === id)!, rows)?.id ?? null;
    const onA = q(1, { method_group_ids: "[10]" }), onFast = q(2, { method_group_ids: "[12]" }), single = q(3, { method_group_id: 12 }), byName = q(4, { method_group_name: "row fast" }), onB = q(5, { method_group_ids: "[11,10]" });
    check("picker: a row with no quiz of its own takes one on its group", pick([onA], 12) === 1);
    check("picker: so does a quiz labeled by the older single id", pick([q(6, { method_group_id: 10 })], 12) === 6);
    check("picker: its own list match beats the group, whatever the order", pick([onA, onFast], 12) === 2);
    check("picker: its own single id beats the group", pick([onA, single], 12) === 3);
    check("picker: the single id beats the list, as before", pick([onFast, single], 12) === 3);
    check("picker: a name match beats the group, as a found quiz never changes", pick([onA, byName], 12) === 4);
    check("picker: the list beats a name match, as before", pick([byName, onFast], 12) === 2);
    check("picker: a quiz on another group isn't offered", pick([q(7, { method_group_ids: "[13]" })], 12) === null);
    check("picker: a row in no group finds nothing through a group", pick([onA, onB], 14) === null);
    check("picker: nor does a quiz with no label reach a group", pick([q(8, {})], 12) === null);
    check("picker: nor a quiz whose ids aren't on this program", pick([q(9, { method_group_ids: "[999]" })], 12) === null);
    check("picker: a malformed list is skipped without throwing", pick([q(11, { method_group_ids: "{bad" }), onA], 12) === 1);
    check("picker: nothing at all stays nothing, so the form says no quiz yet", pick([], 12) === null);
    check("picker: the older name rule still works", findQuizForMethodGroup([q(21, { method_group_name: "VITROS 5600 Quiz" })], { id: 30, name: "Chem VITROS 5600 Primary" }, [])?.id === 21);

    // 6. Staff login
    await call("POST", `${L}/staff/lab`, { labName: "Made-up Quiz Lab", cliaNumber: "11D7654392", accreditationBody: "CLIA_ONLY", complexity: "moderate" }, OWNER.token);
    const staffEmp = Number((await call("POST", `${L}/staff/employees`, { lastName: "Madeup", firstName: "Staff", title: "Made-up Tech", highestComplexity: "M", performsTesting: true, hireDate: "2019-03-01" }, OWNER.token)).j.id);
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)").run(labId, STAFF.id, now, now, now);
    sqlite.prepare("INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type, staff_employee_id) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 'staff_portal', ?)").run(OWNER.id, STAFF.email, STAFF.id, now, now, '{"mode":"view_all"}', `qfg-${stamp}`, labId, staffEmp);
    const asStaff = await call("GET", detailUrl, undefined, STAFF.token);
    check("a Staff login is refused the tab", (await call("GET", G, undefined, STAFF.token)).s === 403);
    check("and doesn't get its groups on the program", asStaff.s === 200 && (asStaff.j.methodGroups as any[]).length > 0 && !asStaff.text.includes("labGroups") && !asStaff.text.includes("Back again"), `HTTP ${asStaff.s}`);
    check("the owner still does", row(await detail(), "Chemistry - A").labGroups[0]?.name === "Back again");
    check("a program in another lab isn't reachable through this lab's route", (await call("GET", `${L2}/competency/programs/${programId}`, undefined, OTHER.token)).s === 404);
  } finally {
    server.close();
  }
  console.log(failures ? `${failures} FAILED` : "ALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
