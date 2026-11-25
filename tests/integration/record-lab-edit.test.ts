// tests/integration/record-lab-edit.test.ts
//
// A change to a record found by its id is decided in the record's own laboratory (BUG-196; server/labAccessGuard.ts
// editRefusedInRecordLab). Boots the REAL routes on a scratch SQLite file with made-up labs and people and, for every route in
// recordLabRoutes.ts, in a sister lab (one owner) and in another customer's lab, proves:
//   1. the record's lab: its editor still changes it, whatever lab the request names; so do someone who edits both, the lab's owner,
//      its admin with no seat, and an older seat with no lab on it
//   2. someone without edit there changes nothing and the record is as it was: edit in another lab and view here, a member here with
//      no seat, a Staff login here, another module's editor, someone with no tie now, the person who made the record and has left
//   3. the organization's admin with no membership and Veritas support answer as before, and so does an editor of the record's lab
//      who works in a lab they only view (the check on the lab being worked in is unchanged)
//   4. a record with no lab keeps the owner rule; rows found another way (a setting kept per lab, a roster, a correlation, an upload)
//   5. a child made under a record takes that record's lab
//   6. the rule asked directly: a read, a route with no module edit check, a record with no lab, and Veritas support in its own lab
// RECORD_LAB_EDIT_OUT=<file> writes every answer, to compare two versions of the code.
// Run: npm run test:record-lab-edit
import fs from "node:fs";
import { inspectionWorld, type Login } from "./inspectionFixture";
import { recordRoutes, type RecordRoute } from "./recordLabRoutes";

const OLD_DATE = "2026-03-01T12:00:00.000Z";

async function main() {
  const w = await inspectionWorld("rle");
  const { sqlite, base, call, check, seed, member, seat, login, one, A, B, X, OWNER, OTHER, LEADER, SUPPORT, now } = w;
  const quiet = console.warn; console.warn = () => {};

  // OWNER's home lab is A; OTHER's only lab is X. A third lab of OWNER's with no VeritaStaff setup.
  const C = Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, created_at, updated_at) SELECT 'Made-up Lab C', owner_user_id, plan, subscription_status, subscription_expires_at, ?, ? FROM labs WHERE id = ?").run(now, now, A).lastInsertRowid);
  member(C, OWNER, "owner");
  sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(A, A, OWNER.id);
  sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(X, X, OTHER.id);

  const routes = recordRoutes({ seed, one, now, stamp: w.stamp });
  const answers: Record<string, string> = {};

  const send = async (who: Login, r: RecordRoute, made: ReturnType<RecordRoute["make"]>, header?: number) => {
    if (!made.file) return call(who, r.method, made.path, made.body, header);
    const form = new FormData();
    form.append("file", new Blob(["made-up text"], { type: "text/plain" }), "made-up.txt");
    const headers: Record<string, string> = { Authorization: `Bearer ${who.token}` };
    if (header) headers["X-Active-Lab-Id"] = String(header);
    const res = await fetch(base + made.path, { method: r.method, headers, body: form });
    await res.arrayBuffer();
    return { s: res.status };
  };
  const tryIt = async (who: Login, r: RecordRoute, lab: number, ownerId: number, header?: number) => {
    const made = r.make(lab, ownerId), before = made.snap();
    const res = await send(who, r, made, header);
    return { s: res.s, changed: made.snap() !== before };
  };
  const ok = (a: { s: number; changed: boolean }) => a.s >= 200 && a.s < 300 && a.changed;
  const refused = (a: { s: number; changed: boolean }) => (a.s === 403 || a.s === 404) && !a.changed;
  const say = (a: { s: number; changed: boolean }) => `${a.s}${a.changed ? " changed" : ""}`;

  const oldSeat = (ownerId: number, u: Login, lab: number | null, perms: any) => seed("user_seats", {
    owner_user_id: ownerId, seat_email: u.email, seat_user_id: u.id, invited_at: OLD_DATE, accepted_at: OLD_DATE, status: "active",
    permissions: JSON.stringify(perms), invite_token: `rle-old-${w.stamp}-${u.id}`, lab_id: lab, seat_type: "active",
  });

  for (const [where, R, owner] of [["sister lab", B, OWNER], ["another customer's lab", X, OTHER]] as const) {
    const k = where === "sister lab" ? "b" : "x";
    const p = (name: string) => login(`${k}${name}`, `Made Up ${name}`);
    // Each person's seat in the record's lab is made first, so it is their first seat.
    const EDITS = await p("edits"); member(R, EDITS); seat(owner.id, EDITS, R);
    const BOTH = await p("both"); member(R, BOTH); seat(owner.id, BOTH, R); member(A, BOTH); seat(OWNER.id, BOTH, A);
    const VIEWS = await p("views"); member(R, VIEWS); seat(owner.id, VIEWS, R, { perms: { mode: "view_all" } }); member(A, VIEWS); seat(OWNER.id, VIEWS, A);
    const VIEWONLY = await p("viewonly"); member(R, VIEWONLY); seat(owner.id, VIEWONLY, R, { perms: { mode: "view_all" } });
    const NOSEAT = await p("noseat"); member(R, NOSEAT); member(A, NOSEAT); seat(OWNER.id, NOSEAT, A);
    const STAFF = await p("staff"); member(R, STAFF); seat(owner.id, STAFF, R, { type: "staff_portal", perms: {} }); member(A, STAFF); seat(OWNER.id, STAFF, A);
    const OUT = await p("out"); member(A, OUT); seat(OWNER.id, OUT, A);
    const LEFT = await p("left"); member(A, LEFT); seat(OWNER.id, LEFT, A);
    const LEFTOWNER = owner.id === OWNER.id ? OTHER : OWNER; // owns a lab of their own, and once worked here
    const HEREONLY = await p("hereonly"); member(R, HEREONLY); seat(owner.id, HEREONLY, R); member(A, HEREONLY); seat(OWNER.id, HEREONLY, A, { perms: { mode: "view_all" } });
    const ADMIN = await p("admin"); member(R, ADMIN, "admin");
    const OLDER = await p("older"); oldSeat(owner.id, OLDER, null, { mode: "edit_all" });
    const OLDERVIEW = await p("olderview"); oldSeat(owner.id, OLDERVIEW, null, { mode: "view_all" });
    const OLDERTIED = await p("oldertied"); oldSeat(owner.id, OLDERTIED, owner.id === OWNER.id ? A : R, { mode: "edit_all" });
    const MODULE: Record<string, Login> = {};
    for (const mod of new Set(routes.map((r) => r.module))) {
      const u = MODULE[mod] = await p(`not${mod}`);
      member(R, u); seat(owner.id, u, R, { perms: { mode: "custom", overrides: Object.fromEntries([...new Set(routes.map((r) => r.module))].map((m) => [m, m === mod ? "view" : "edit"])) } });
      member(A, u); seat(OWNER.id, u, A);
    }

    for (const r of routes) {
      const label = `${r.method} ${r.name} (${where})`;
      const at = async (who: string, u: Login, header?: number, madeBy = r.ownOnly ? u.id : owner.id) => {
        const a = await tryIt(u, r, R, madeBy, header);
        answers[`${k} ${r.method} ${r.name} | ${who} @${header === R ? "R" : header === A ? "A" : header ? "none of theirs" : "-"}`] = say(a);
        return a;
      };
      const oneLab = !(r.oneLabOnly && owner.id === OWNER.id);
      const may = async (who: string, u: Login, headers: Array<number | undefined>, reach = true) => {
        const got = [];
        for (const h of headers) got.push(await at(who, u, h));
        // The older assessment routes answer 409 for an account with several labs, and some routes want the stored owner's account.
        const want = !oneLab ? (a: any) => a.s === 409 && !a.changed : reach ? ok : refused;
        if (oneLab || reach) check(`1. ${label}: ${who}${oneLab && reach ? " changes it" : " as before"}`, got.every(want), got.map(say).join(", "));
        else check(`1. ${label}: ${who} as before`, got.every((a) => !a.changed), got.map(say).join(", "));
      };
      await may("its editor", EDITS, [R, undefined, A, 999999]);
      await may("who edits both labs", BOTH, [R, A, undefined]);
      await may("the owner", owner, [R, undefined, ...(owner.id === OWNER.id ? [A] : [])]);
      if (oneLab || !r.ownRows) await may("the lab's admin with no seat", ADMIN, [R, undefined], !r.ownRows);
      await may("an older seat with no lab", OLDER, [R, undefined], !r.ownEditRule);
      await may("an older seat, view only", OLDERVIEW, [R, undefined], !r.ownEditRule);
      if (owner.id === OWNER.id) await may("an older seat tied to a sister lab", OLDERTIED, [R, undefined], !r.ownEditRule);

      const mayNot = async (who: string, u: Login, headers: Array<number | undefined>, madeBy?: number) => {
        const got = [];
        for (const h of headers) got.push(await at(who, u, h, madeBy));
        check(`2. ${label}: ${who} changes nothing`, got.every(refused), got.map(say).join(", "));
      };
      await mayNot("edit in another lab, view here", VIEWS, [A, R, undefined]);
      await mayNot("view only here", VIEWONLY, [R, undefined, A]);
      await mayNot("a member here with no seat", NOSEAT, [A, R, undefined]);
      await mayNot("a Staff login here", STAFF, [A, R, undefined]);
      await mayNot("this module view only, every other one edit", MODULE[r.module], [A, R]);
      await mayNot("no tie to the lab", OUT, [A, R, undefined], r.ownOnly ? owner.id : undefined);
      await mayNot("who made the record and has left", LEFT, [A, undefined], LEFT.id);
      await mayNot("who made the record, has left, and owns another lab", LEFTOWNER, [owner.id === OWNER.id ? X : A, undefined], LEFTOWNER.id);

      const asBefore = async (who: string, u: Login, headers: Array<number | undefined>) => {
        for (const h of headers) {
          const a = await at(who, u, h, owner.id);
          check(`3. ${label}: ${who} is refused, as before`, !a.changed && (a.s === 403 || a.s === 404), say(a));
        }
      };
      if (R === B) await asBefore("the organization's admin with no membership", LEADER, [R, undefined]);
      await asBefore("Veritas support", SUPPORT, [R, undefined]);
      await asBefore("its editor, working in a lab they only view", HEREONLY, [A]);
      await may("its editor who views another lab", HEREONLY, [R]);
    }
  }

  // ── 4. A record with no lab, and rows that aren't one record id ─────────────────────────────────────────────────────────────
  const E = await login("nolab", "Nola Nolab"); member(A, E); seat(OWNER.id, E, A);
  const V = await login("split", "Spence Split"); member(A, V); seat(OWNER.id, V, A); member(B, V); seat(OWNER.id, V, B, { perms: { mode: "view_all" } });
  for (const r of routes.filter((x) => ["study", "finding", "scan", "map", "program", "certificate", "cost study", "inventory item"].includes(x.name) && x.method === "DELETE")) {
    const made = r.make(null as any, OWNER.id), before = made.snap();
    const res = await send(E, r, made, A);
    check(`4a. ${r.method} ${r.name} with no lab: the owner rule, as before`, res.s === 200 && made.snap() !== before, `${res.s}`);
  }
  // The older account-level VeritaDC settings are the owner's home lab's (A).
  const HB = await login("homeb", "Hollis Homeb"); member(B, HB); seat(OWNER.id, HB, B);
  const settings = () => JSON.stringify(one("SELECT * FROM veritapolicy_settings WHERE lab_id = ?", A) ?? null) + JSON.stringify(one("SELECT * FROM veritapolicy_master_status WHERE lab_id = ? AND policy_id = 'P1'", A) ?? null);
  const s0 = settings();
  const set = [
    await call(HB, "PUT", "/api/veritapolicy/settings", { is_independent: true, setup_complete: true, accreditation_body: "cap" }, B),
    await call(HB, "PATCH", "/api/veritapolicy/master-list/P1", { status: "complete" }, B),
  ];
  answers["settings | other lab's editor"] = set.map((x) => x.s).join();
  check("4b. a setting kept on the home lab isn't another lab's editor's to change", set.every((x) => x.s === 400) && settings() === s0, set.map((x) => x.s).join());
  const setOk = [
    await call(E, "PUT", "/api/veritapolicy/settings", { is_independent: true, setup_complete: true, accreditation_body: "cap" }, A),
    await call(OWNER, "PATCH", "/api/veritapolicy/master-list/P1", { status: "complete" }, B),
  ];
  answers["settings | its editor, the owner"] = setOk.map((x) => x.s).join();
  check("4c. the home lab's editor and the owner still change it", setOk.every((x) => x.s === 200) && settings() !== s0, setOk.map((x) => x.s).join());
  // A requirement's status belongs to the lab the request falls back to.
  const FB = await login("fallback", "Finley Fallback"); member(A, FB); seat(OWNER.id, FB, A); member(B, FB); seat(OWNER.id, FB, B, { perms: { mode: "view_all" } });
  sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(A, B, FB.id);
  const reqRows = (lab: number) => Number(one("SELECT COUNT(*) AS n FROM veritapolicy_requirement_status WHERE lab_id = ?", lab).n);
  const rq0 = reqRows(B), rq = await call(FB, "PATCH", "/api/veritapolicy/requirements/7", { status: "complete" });
  answers["requirement | falls back to a lab viewed"] = String(rq.s);
  check("4d. a requirement's status isn't changed in a lab the person only views", rq.s === 404 && reqRows(B) === rq0, `${rq.s}`);
  const rqA = reqRows(A), rq2 = await call(FB, "PATCH", "/api/veritapolicy/requirements/7", { status: "complete" }, A);
  check("4e. and is in the lab they edit", rq2.s === 200 && reqRows(A) === rqA + 1, `${rq2.s}`);

  // The older upload answers after finding its policy; nothing reads a file there any more.
  const polB = seed("veritapolicy_lab_policies", { user_id: OWNER.id, lab_id: B, policy_name: "Upload" });
  const up = [await call(V, "POST", `/api/veritapolicy/policies/${polB}/upload`, {}, A), await call(OWNER, "POST", `/api/veritapolicy/policies/${polB}/upload`, {}, B)];
  check("4p. the upload finds a policy only for its lab's editor", up[0].s === 404 && up[1].s !== 404 && up[1].s !== 403, up.map((x) => x.s).join());

  // The older roster routes find the account's one VeritaStaff lab when the lab being worked in has none.
  const XV = await login("xview", "Xan Xview"); member(X, XV); seat(OTHER.id, XV, X, { perms: { mode: "view_all" } }); member(C, XV); seat(OWNER.id, XV, C);
  const XE = await login("xedit", "Xia Xedit"); member(X, XE); seat(OTHER.id, XE, X); member(C, XE); seat(OWNER.id, XE, C);
  const staffLabX = Number(one("SELECT id FROM staff_labs WHERE tier2_lab_id = ?", X)?.id ?? seed("staff_labs", { user_id: OTHER.id, tier2_lab_id: X, lab_name: "Made-up Lab X", clia_number: "22D0000778" }));
  const emp = seed("staff_employees", { user_id: OTHER.id, lab_id: staffLabX, tier2_lab_id: X, first_name: "Made", last_name: "Up", status: "active", highest_complexity: "high" });
  const empRow = () => JSON.stringify(one("SELECT last_name, status FROM staff_employees WHERE id = ?", emp)) + JSON.stringify(one("SELECT notes FROM staff_competency_schedules WHERE employee_id = ?", emp) ?? null);
  const roster = async (u: Login, header?: number) => [
    await call(u, "PUT", `/api/staff/employees/${emp}`, { lastName: "Changed" }, header),
    await call(u, "PUT", `/api/staff/competency/${emp}`, { notes: "changed" }, header),
    await call(u, "DELETE", `/api/staff/employees/${emp}`, undefined, header),
  ];
  const e0 = empRow();
  for (const h of [C, X]) {
    const got = await roster(XV, h);
    answers[`roster | view here @${h === C ? "C" : "X"}`] = got.map((x) => x.s).join();
    check(`4f. the roster of a lab the person only views isn't changed (${h === C ? "working in another lab" : "working in it"})`, got.every((x) => [400, 403, 404].includes(x.s)) && empRow() === e0, got.map((x) => x.s).join());
  }
  const gotE = await roster(XE, X);
  answers["roster | its editor @X"] = gotE.map((x) => x.s).join();
  check("4g. its editor changes it", gotE.every((x) => x.s === 200) && empRow() !== e0, gotE.map((x) => x.s).join());

  // Correlations: both tests, the saved correlation and its group belong to the lab being worked in.
  const testIn = (lab: number, owner: number) => seed("veritamap_tests", { map_id: seed("veritamap_maps", { user_id: owner, lab_id: lab, name: "Correlated" }), analyte: "Glucose", specialty: "Chemistry", complexity: "MODERATE", active: 1, instrument_source: "a, b", updated_at: now });
  const tA = testIn(A, OWNER.id), tB = testIn(B, OWNER.id), tX = testIn(X, OTHER.id);
  const corr = (t: number, group: number | null) => seed("veritamap_test_correlations", { test_a_id: t, test_b_id: t, correlation_group_id: group, notes: "as it was", created_at: now, updated_at: now });
  const cA = corr(tA, 501), cB = corr(tB, 502), cX = corr(tX, 503);
  const corrRow = (id: number) => JSON.stringify(one("SELECT * FROM veritamap_test_correlations WHERE id = ?", id) ?? null);
  const [b0, x0] = [corrRow(cB), corrRow(cX)];
  for (const h of [A, B]) {
    const got = [
      await call(V, "POST", "/api/veritamap/correlations", { id: cB, test_a_id: tA, test_b_id: tA, notes: "changed" }, h),
      await call(V, "POST", "/api/veritamap/correlations", { id: cX, test_a_id: tA, test_b_id: tA, notes: "changed" }, h),
      await call(V, "POST", "/api/veritamap/correlations", { test_a_id: tA, test_b_id: tA, correlation_group_id: 502 }, h),
      await call(V, "POST", "/api/veritamap/correlations", { test_a_id: tB, test_b_id: tB, notes: "changed" }, h),
      await call(V, "POST", "/api/veritamap/correlations/group/502/signoff", { signoff_date: "2026-11-01" }, h),
      await call(V, "DELETE", `/api/veritamap/correlations/${cB}`, undefined, h),
    ];
    answers[`correlations | view there @${h === A ? "A" : "B"}`] = got.map((x) => x.s).join();
    check(`4h. another lab's correlation isn't changed (${h === A ? "working in the lab they edit" : "working in the lab they view"})`, got.every((x) => x.s === 403 || x.s === 404) && corrRow(cB) === b0 && corrRow(cX) === x0 && one("SELECT COUNT(*) AS n FROM veritamap_test_correlations WHERE correlation_group_id = 502").n === 1, got.map((x) => x.s).join());
  }
  const mine = [
    await call(V, "POST", "/api/veritamap/correlations", { id: cA, test_a_id: tA, test_b_id: tA, correlation_group_id: 501, notes: "changed" }, A),
    await call(V, "POST", "/api/veritamap/correlations", { test_a_id: tA, test_b_id: tA, correlation_group_id: 501 }, A),
    await call(V, "POST", "/api/veritamap/correlations", { test_a_id: tA, test_b_id: tA }, A),
    await call(V, "POST", "/api/veritamap/correlations", { test_a_id: tA, test_b_id: tA, correlation_group_id: 599 }, A),
    await call(V, "POST", "/api/veritamap/correlations/group/501/signoff", { signoff_date: "2026-11-01" }, A),
    await call(OWNER, "POST", "/api/veritamap/correlations", { id: cB, test_a_id: tB, test_b_id: tB, notes: "owner" }, B),
    await call(V, "DELETE", `/api/veritamap/correlations/${cA}`, undefined, A),
  ];
  answers["correlations | its editor, the owner"] = mine.map((x) => x.s).join();
  check("4i. their own lab's is, and the owner's", mine.every((x) => x.s === 200) && !one("SELECT id FROM veritamap_test_correlations WHERE id = ?", cA) && one("SELECT notes FROM veritamap_test_correlations WHERE id = ?", cB)?.notes === "owner", mine.map((x) => x.s).join());

  // ── 5. A child takes its record's lab ───────────────────────────────────────────────────────────────────────────────────────
  const both = await login("bothkids", "Bo Bothkids"); member(A, both); seat(OWNER.id, both, A); member(B, both); seat(OWNER.id, both, B);
  const pB = seed("competency_programs", { user_id: OWNER.id, lab_id: B, name: "Program B", department: "Chemistry", type: "nontechnical" });
  const q = await call(both, "POST", `/api/veritacomp/programs/${pB}/quizzes`, { title: "New", questions: [{ id: "q1", question: "Which?", options: ["a", "b"], correct_answer: "a" }] }, A);
  check("5a. a quiz is in its program's lab", q.s === 200 && one("SELECT lab_id FROM competency_quizzes WHERE id = ?", q.j?.id)?.lab_id === B, `${q.s}`);
  const docRoute = routes.find((r) => r.name === "certificate document" && r.method === "POST")!;
  const madeDoc = docRoute.make(B, OWNER.id), docSent = await send(both, docRoute, madeDoc, A);
  const docLab = one("SELECT lab_id FROM lab_certificate_documents ORDER BY id DESC LIMIT 1")?.lab_id;
  check("5b. a certificate's document is in the certificate's lab", docSent.s === 201 && docLab === B, `${docSent.s} ${docLab}`);

  if (process.env.RECORD_LAB_EDIT_OUT) fs.writeFileSync(process.env.RECORD_LAB_EDIT_OUT, JSON.stringify(answers, null, 1));

  // ── 6. The rule, asked directly ─────────────────────────────────────────────────────────────────────────────────────────────
  const { editRefusedInRecordLab } = await import("../../server/labAccessGuard");
  const ask = (u: Login, lab: unknown, more: Record<string, any> = {}) => editRefusedInRecordLab(sqlite, { method: "PUT", userId: u.id, ownerUserId: u.id, moduleEditChecked: "veritamap", ...more }, lab);
  check("6a. a change in a lab the person views is refused, in one they edit it isn't", ask(V, B) && !ask(V, A));
  check("6b. a read, and a route with no module edit check, aren't judged here", !ask(V, B, { method: "GET" }) && !ask(V, B, { moduleEditChecked: undefined }));
  check("6c. a record with no lab isn't", !ask(V, null) && !ask(V, undefined) && !ask(V, 0));
  check("6d. Veritas support passes in the lab it was let into and no other", !ask(SUPPORT, B, { scope: { viaVlsSupport: true, labId: B } }) && ask(SUPPORT, B, { scope: { viaVlsSupport: true, labId: A } }) && ask(SUPPORT, B));
  check("6e. the organization's admin passes in its labs and no other", !ask(LEADER, B) && ask(LEADER, X));

  console.warn = quiet;
  console.log(`${routes.length} routes, ${Object.keys(answers).length} answers`);
  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
