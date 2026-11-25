// tests/integration/inspection-assign.test.ts
//
// STANDING integration test for assigning inspection work (B6, 2026-11-24; server/inspectionAssign.ts,
// server/assignablePeople.ts, server/veritascanItems.ts, server/audit.ts).
//   1. Who can be picked, and who reads the list.
//   2. A finding: assign, change, clear; one email each time it goes to someone; the finding's history; the list's name.
//   3. Refusals: another lab, a person outside the lab, a view-only reviewer, a Staff login, an editor of another module,
//      Veritas support. Nothing written and nothing mailed.
//   4. Due-date reminders: the creating account as before, plus the assignee when that is someone else who is still here.
//   5. A VeritaScan item: assign, an auto-save from another browser can't undo it, change, clear, typed names kept,
//      Assigned to me across scans, audit rows, refusals.
//   6. A failed study opens a finding: only FAIL, only once, named and linked both ways, refusals.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:inspection-assign
import { inspectionWorld } from "./inspectionFixture";

async function main() {
  const w = await inspectionWorld("assign");
  const { A, B, X, call, check, one, all, sent, sqlite, seed } = w;
  const { OWNER, OTHER, EDITOR, SCAN_ONLY, VIEWER, STAFF, ADMIN_A, LEADER, SUPPORT } = w;
  const { runFindingReminders, findingReminderCandidates, findingReminderRecipients } = await import("../../server/audit");

  // ── 1. Who can be picked ──────────────────────────────────────────────────
  const people = await call(EDITOR, "GET", `/api/labs/${A}/assignable-people?module=veritaresponse`);
  const ids = (people.j?.people ?? []).map((p: any) => p.userId);
  check("1a. owner, editor, reviewer, Staff login and admin are listed", [OWNER, EDITOR, VIEWER, STAFF, ADMIN_A].every((u) => ids.includes(u.id)), people.text);
  check("1b. another customer, the organization's admin with no membership, and Veritas support are not", ![OTHER, LEADER, SUPPORT].some((u) => ids.includes(u.id)));
  check("1c. the Staff login is marked as one, the editor isn't", people.j.people.find((p: any) => p.userId === STAFF.id)?.staffLogin === true && people.j.people.find((p: any) => p.userId === EDITOR.id)?.staffLogin === false);
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["an editor of VeritaScan only", SCAN_ONLY], ["Veritas support", SUPPORT]] as const) {
    const r = await call(u, "GET", `/api/labs/${A}/assignable-people?module=veritaresponse`);
    check(`1d. ${who} doesn't read the list`, r.s === 403 && !r.text.includes(EDITOR.email), `${r.s}`);
  }
  const otherList = await call(OTHER, "GET", `/api/labs/${A}/assignable-people?module=veritaresponse`);
  check("1e. another customer is refused", otherList.s === 403 && !otherList.text.includes(EDITOR.email), `${otherList.s}`);
  const scanPeople = await call(SCAN_ONLY, "GET", `/api/labs/${A}/assignable-people?module=veritascan`);
  check("1f. an editor of VeritaScan reads it for VeritaScan", scanPeople.s === 200 && scanPeople.j.people.length >= 5);
  // A roster person whose login has no membership row still counts; one whose roster entry is inactive doesn't.
  const SEATED = await w.login("seated", "Sam Seated"); const seatedEmp = w.roster("Sam", "Seated"); w.seat(OWNER.id, SEATED, A, { type: "staff_portal", roster: seatedEmp, perms: {} });
  const LEFT = await w.login("left", "Lou Left"); const leftEmp = w.roster("Lou", "Left"); w.seat(OWNER.id, LEFT, A, { type: "staff_portal", roster: leftEmp, perms: {} }); sqlite.prepare("UPDATE staff_employees SET status = 'inactive' WHERE id = ?").run(leftEmp);
  const again = (await call(EDITOR, "GET", `/api/labs/${A}/assignable-people?module=veritaresponse`)).j.people.map((p: any) => p.userId);
  check("1g. a roster person with a Staff login is listed; one off the roster isn't", again.includes(SEATED.id) && !again.includes(LEFT.id));

  // ── 2. A finding ──────────────────────────────────────────────────────────
  const mk = async (lab: number, who: any, extra: any = {}) => Number((await call(who, "POST", `/api/labs/${lab}/findings`, { accreditor: "CMS", anchor_date: "2026-11-01", description: "Made-up: log gaps <b>", ...extra })).j?.id);
  const f1 = await mk(A, EDITOR, { finding_number: "D5411", standard_ref: "42 CFR 493.1253" });
  const F = `/api/labs/${A}/findings/${f1}/assignee`;
  const hist = (id: number) => all("SELECT event, by_user_id, payload FROM finding_history WHERE finding_id = ? AND event LIKE 'assign%' ORDER BY id", id).map((h) => ({ ...h, payload: JSON.parse(h.payload) }));
  const start = await call(EDITOR, "GET", F);
  check("2a. a new finding is assigned to no one, and an editor may assign", start.s === 200 && start.j.assignee === null && start.j.canAssign === true);
  sent.length = 0;
  const assigned = await call(EDITOR, "PUT", F, { user_id: STAFF.id });
  check("2b. assigning stores the person, who and when", assigned.s === 200 && one("SELECT assignee_user_id FROM findings WHERE id = ?", f1).assignee_user_id === STAFF.id && one("SELECT assigned_by_user_id FROM findings WHERE id = ?", f1).assigned_by_user_id === EDITOR.id && !!one("SELECT assigned_at FROM findings WHERE id = ?", f1).assigned_at, assigned.text);
  check("2c. one email, to the assignee, naming the finding and linking to it", sent.length === 1 && sent[0].to === STAFF.email && sent[0].subject.includes("D5411") && sent[0].html.includes(`/labs/${A}/veritaresponse/${f1}`) && sent[0].html.includes("42 CFR 493.1253") && assigned.j.email === "sent", JSON.stringify(sent));
  check("2d. the email holds no description, and no em or en dash", !/log gaps/.test(sent[0].html) && !/[–—]/.test(sent[0].subject + sent[0].html));
  const same = await call(EDITOR, "PUT", F, { user_id: STAFF.id });
  check("2e. saving the same person again: no second email and no second history row", same.j?.unchanged === true && sent.length === 1 && hist(f1).length === 1);
  const list = await call(EDITOR, "GET", `/api/labs/${A}/findings`);
  const row = list.j.find((x: any) => x.id === f1);
  check("2f. the list shows who it is assigned to", row?.assignee_user_id === STAFF.id && row?.assignee_name === "Stef Staff");
  check("2g. the assignee sees it is theirs and can't reassign it", (await call(STAFF, "GET", F)).j?.mine === true && (await call(STAFF, "GET", F)).j?.canAssign === false);
  await call(EDITOR, "PUT", F, { user_id: EDITOR.id });
  check("2h. changing it: one more email, to the new person only", sent.length === 2 && sent[1].to === EDITOR.email);
  await call(EDITOR, "PUT", F, { user_id: null });
  const h = hist(f1);
  check("2i. assign, change and clear are each in the history with before and after", h.map((x) => x.event).join(",") === "assigned,assignment_changed,assignment_cleared"
    && h[0].payload.before === null && h[0].payload.after.user_id === STAFF.id && h[1].payload.before.name === "Stef Staff" && h[1].payload.after.user_id === EDITOR.id
    && h[2].payload.before.user_id === EDITOR.id && h[2].payload.after === null && h.every((x) => x.by_user_id === EDITOR.id), JSON.stringify(h));
  check("2j. clearing mails no one and empties the columns", sent.length === 2 && one("SELECT assignee_user_id, assigned_at, assigned_by_user_id FROM findings WHERE id = ?", f1).assignee_user_id === null);
  w.mail.fail = true;
  const mailDown = await call(EDITOR, "PUT", F, { user_id: ADMIN_A.id });
  w.mail.fail = false;
  check("2k. a mail failure still saves and says so", mailDown.s === 200 && mailDown.j.email === "failed" && one("SELECT assignee_user_id FROM findings WHERE id = ?", f1).assignee_user_id === ADMIN_A.id);
  const put = await call(EDITOR, "PUT", `/api/labs/${A}/findings/${f1}`, { description: "Made-up: edited", assignee_user_id: OTHER.id });
  check("2l. the page's own save can't change the assignee", put.s === 200 && one("SELECT assignee_user_id FROM findings WHERE id = ?", f1).assignee_user_id === ADMIN_A.id);

  // ── 3. Refusals ───────────────────────────────────────────────────────────
  const before3 = sent.length;
  for (const [who, u, want] of [["a view-only reviewer", VIEWER, 403], ["a Staff login", STAFF, 403], ["an editor of VeritaScan only", SCAN_ONLY, 403], ["Veritas support", SUPPORT, 403], ["another customer", OTHER, 403]] as const) {
    const r = await call(u, "PUT", F, { user_id: EDITOR.id });
    check(`3a. ${who} can't assign`, r.s === want, `${r.s} ${r.text.slice(0, 120)}`);
  }
  const sup = await call(SUPPORT, "PUT", F, { user_id: EDITOR.id });
  check("3b. support's refusal is the signing one, and support still reads the finding", sup.j?.code === "VLS_SUPPORT_CANNOT_SIGN" && (await call(SUPPORT, "GET", `/api/labs/${A}/findings/${f1}`)).s === 200);
  for (const [who, id] of [["another customer's person", OTHER.id], ["an organization admin with no membership", LEADER.id], ["support", SUPPORT.id], ["someone off the roster", LEFT.id], ["no such user", 9999999]] as const) {
    const r = await call(EDITOR, "PUT", F, { user_id: id });
    check(`3c. ${who} can't be picked`, r.s === 400 && r.j?.code === "ASSIGNEE_NOT_ON_LAB", `${r.s} ${r.text}`);
  }
  for (const bad of [undefined, "", "abc", -1, 1.5]) {
    const r = await call(EDITOR, "PUT", F, { user_id: bad });
    check(`3d. ${JSON.stringify(bad)} is refused, not read as a clear`, r.s === 400, `${r.s}`);
  }
  const fX = await mk(X, OTHER);
  check("3e. a finding of another lab isn't found through this lab", (await call(EDITOR, "PUT", `/api/labs/${A}/findings/${fX}/assignee`, { user_id: EDITOR.id })).s === 404 && (await call(EDITOR, "GET", `/api/labs/${A}/findings/${fX}/assignee`)).s === 404);
  check("3f. nothing was written or mailed by any refusal", one("SELECT assignee_user_id FROM findings WHERE id = ?", f1).assignee_user_id === ADMIN_A.id && one("SELECT assignee_user_id FROM findings WHERE id = ?", fX).assignee_user_id === null && sent.length === before3 && hist(f1).length === 4);

  // ── 4. Reminders ──────────────────────────────────────────────────────────
  // The lab's own day, as the job counts it; the UTC day is already tomorrow after 7 PM Eastern.
  const { addLabDays, labTimeZoneById, labToday } = await import("../../server/dateLocal");
  const inDays = (n: number) => addLabDays(labToday(labTimeZoneById(sqlite, A)), n);
  const rem = async () => { const id = await mk(A, EDITOR); sqlite.prepare("UPDATE findings SET due_date = ? WHERE id = ?").run(inDays(7), id); return id; };
  const [rNone, rOther, rOwner, rGone] = [await rem(), await rem(), await rem(), await rem()];
  const GONE = await w.login("gone", "Gil Gone"); w.member(A, GONE);
  await call(EDITOR, "PUT", `/api/labs/${A}/findings/${rOther}/assignee`, { user_id: STAFF.id });
  await call(EDITOR, "PUT", `/api/labs/${A}/findings/${rOwner}/assignee`, { user_id: OWNER.id });
  await call(EDITOR, "PUT", `/api/labs/${A}/findings/${rGone}/assignee`, { user_id: GONE.id });
  sqlite.prepare("UPDATE lab_members SET status = 'inactive' WHERE lab_id = ? AND user_id = ?").run(A, GONE.id);
  const to = (id: number) => findingReminderRecipients(sqlite, findingReminderCandidates(sqlite).find((c: any) => c.id === id)).join(",");
  check("4a. no assignee: the creating account only, as before", to(rNone) === OWNER.email, to(rNone));
  check("4b. an assignee who is someone else: both", to(rOther) === `${OWNER.email},${STAFF.email}`, to(rOther));
  check("4c. the assignee is the creating account: once", to(rOwner) === OWNER.email, to(rOwner));
  check("4d. an assignee who has left the lab gets nothing", to(rGone) === OWNER.email, to(rGone));
  check("4e. and the finding says they are no longer on the lab", (await call(EDITOR, "GET", `/api/labs/${A}/findings/${rGone}/assignee`)).j?.assignee?.on_lab === false);
  // The job itself, with the provider's address answered by a stub: one call per finding, the recipients on it and in the log.
  const realFetch = globalThis.fetch; const calls: any[] = [];
  globalThis.fetch = (async (u: any, init: any) => (String(u).includes("api.resend.com") ? (calls.push(JSON.parse(init.body)), new Response(JSON.stringify({ id: "made-up" }), { status: 200, headers: { "Content-Type": "application/json" } })) : realFetch(u, init))) as any;
  process.env.RESEND_API_KEY = ["made", "up", "key"].join("-");
  await runFindingReminders();
  await runFindingReminders();
  delete process.env.RESEND_API_KEY; globalThis.fetch = realFetch;
  const log = (id: number) => all("SELECT recipient_email FROM finding_reminder_log WHERE finding_id = ?", id).map((r) => r.recipient_email);
  const forBoth = calls.filter((c) => c.to.includes(STAFF.email));
  check("4f. the job mails both once, and a second run mails no one again", forBoth.length === 1 && forBoth[0].to.join(",") === `${OWNER.email},${STAFF.email}` && log(rOther).join("|") === `${OWNER.email}, ${STAFF.email}` && log(rNone).join("|") === OWNER.email && calls.filter((c) => c.to.includes(GONE.email)).length === 0, JSON.stringify(calls.map((c) => c.to)));

  // ── 5. A VeritaScan item ──────────────────────────────────────────────────
  const s1 = await w.newScan(EDITOR, A, "Made-up Scan One"), s2 = await w.newScan(EDITOR, A, "Made-up Scan Two");
  const S = `/api/labs/${A}/veritascan/scans/${s1}`;
  const item = (scan: number, id: number) => one("SELECT * FROM veritascan_items WHERE scan_id = ? AND item_id = ?", scan, id);
  await call(EDITOR, "PUT", `${S}/items`, { items: [{ itemId: 5, status: "Needs Attention", owner: "Typed Name", notes: "Made-up note", dueDate: "2026-12-01" }, { itemId: 6, status: "Not Assessed", owner: "Typed Six" }] });
  check("5a. a typed owner is kept as typed", item(s1, 5).owner === "Typed Name" && item(s1, 5).owner_user_id === null);
  sent.length = 0;
  const asg = await call(SCAN_ONLY, "PUT", `${S}/items/5/assignee`, { user_id: STAFF.id });
  check("5b. assigning sets the person and their name; status, notes and due date stay", asg.s === 200 && item(s1, 5).owner_user_id === STAFF.id && item(s1, 5).owner === "Stef Staff" && item(s1, 5).status === "Needs Attention" && item(s1, 5).notes === "Made-up note" && item(s1, 5).due_date === "2026-12-01", asg.text);
  check("5c. one email, with the item's question and a link to the scan", sent.length === 1 && sent[0].to === STAFF.email && sent[0].html.includes(`/labs/${A}/veritascan-app/${s1}`) && !sent[0].html.includes("Made-up note"), JSON.stringify(sent));
  await call(SCAN_ONLY, "PUT", `${S}/items/5/assignee`, { user_id: STAFF.id });
  check("5d. the same person again sends nothing", sent.length === 1);
  // Another browser's auto-save, holding the item as it was before
  await call(EDITOR, "PUT", `${S}/items`, { items: [{ itemId: 5, status: "Compliant", owner: "Typed Name" }, { itemId: 6, status: "Not Assessed", owner: "Six Again" }] });
  await call(EDITOR, "PUT", `${S}/items/5`, { status: "Compliant", owner: "Typed Name" });
  await call(OWNER, "PUT", `/api/veritascan/scans/${s1}/items`, { items: [{ item_id: 5, status: "Compliant", owner: "" }] }, A);
  await call(OWNER, "PUT", `/api/veritascan/scans/${s1}/items/5`, { status: "Compliant", owner: "" }, A);
  check("5e. none of the four item saves changes an assigned owner; a typed one still saves", item(s1, 5).owner_user_id === STAFF.id && item(s1, 5).owner === "Stef Staff" && item(s1, 5).status === "Compliant" && item(s1, 6).owner === "Six Again");
  await call(EDITOR, "PUT", `/api/labs/${A}/veritascan/scans/${s2}/items/9/assignee`, { user_id: STAFF.id });
  check("5f. an item with no row yet is made as Not Assessed", item(s2, 9).status === "Not Assessed" && item(s2, 9).owner_user_id === STAFF.id);
  const mine = await call(STAFF, "GET", `/api/labs/${A}/veritascan/assigned-to-me`);
  check("5g. Assigned to me lists both scans' items for the assignee", mine.s === 200 && mine.j.map((m: any) => `${m.scan_id}:${m.item_id}`).sort().join() === [`${s1}:5`, `${s2}:9`].sort().join() && mine.j.every((m: any) => m.question && m.scan_name), mine.text);
  check("5h. and nothing for anyone else", (await call(EDITOR, "GET", `/api/labs/${A}/veritascan/assigned-to-me`)).j.length === 0 && (await call(OTHER, "GET", `/api/labs/${A}/veritascan/assigned-to-me`)).s === 403);
  const read5 = (await call(STAFF, "GET", `${S}/items`)).j.find((i: any) => i.item_id === 5);
  check("5i. the items read carries the person", read5.owner_user_id === STAFF.id && read5.owner === "Stef Staff");
  await call(EDITOR, "PUT", `${S}/items/5/assignee`, { user_id: EDITOR.id });
  await call(EDITOR, "PUT", `${S}/items/5/assignee`, { user_id: null });
  const au = w.audits("veritascan_item", item(s1, 5).id).map((a) => ({ b: JSON.parse(a.before_json), a: JSON.parse(a.after_json), by: a.user_id, own: a.owner_user_id }));
  check("5j. assign, change and clear each wrote one audit row, before and after", au.length === 3 && au[0].b.owner === "Typed Name" && au[0].a.owner_user_id === STAFF.id && au[1].b.owner_user_id === STAFF.id && au[1].a.owner_user_id === EDITOR.id && au[2].a.owner_user_id === null && au[0].by === SCAN_ONLY.id && au.every((x) => x.own === OWNER.id), JSON.stringify(au));
  check("5k. after a clear the owner can be typed again", item(s1, 5).owner === null && (await call(EDITOR, "PUT", `${S}/items/5`, { status: "Compliant", owner: "Typed Later" })).s === 200 && item(s1, 5).owner === "Typed Later");
  const before5 = sent.length, scanX = await w.newScan(OTHER, X, "Made-up Scan X");
  for (const [who, u, path, want] of [
    ["a Staff login", STAFF, `${S}/items/5/assignee`, 403], ["a view-only reviewer", VIEWER, `${S}/items/5/assignee`, 403], ["Veritas support", SUPPORT, `${S}/items/5/assignee`, 403],
    ["another customer", OTHER, `${S}/items/5/assignee`, 403], ["another lab's scan through this lab", EDITOR, `/api/labs/${A}/veritascan/scans/${scanX}/items/5/assignee`, 404],
    ["an item that isn't on the checklist", EDITOR, `${S}/items/99999/assignee`, 404],
  ] as const) {
    const r = await call(u, "PUT", path, { user_id: EDITOR.id });
    check(`5l. ${who} is refused`, r.s === want, `${r.s} ${r.text.slice(0, 120)}`);
  }
  const strangers = await call(EDITOR, "PUT", `${S}/items/5/assignee`, { user_id: OTHER.id });
  check("5m. a person outside the lab can't be picked, and no refusal wrote or mailed anything", strangers.s === 400 && strangers.j?.code === "ASSIGNEE_NOT_ON_LAB" && item(s1, 5).owner_user_id === null && item(scanX, 5) === undefined && sent.length === before5);

  // ── 6. A failed study ─────────────────────────────────────────────────────
  const study = (lab: number | null, status: string, extra: any = {}) => seed("studies", { user_id: OWNER.id, lab_id: lab, test_name: "Glucose", instrument: "Alphamatic 500", analyst: "x", date: "2026-11-20", study_type: "cal_ver", clia_allowable_error: 0.1, data_points: "[]", instruments: "[]", status, created_at: w.now, ...extra });
  const bad = study(A, "fail"), good = study(A, "pass"), draft = study(A, "draft"), overridden = study(A, "pass", { verdict_override_justification: "Made-up", verdict_before_override: "fail" }), inB = study(B, "fail");
  const G = (id: number) => `/api/labs/${A}/studies/${id}/findings`, O = (id: number) => `/api/labs/${A}/studies/${id}/open-finding`;
  const countF = () => one("SELECT COUNT(*) AS n FROM findings WHERE lab_id = ?", A).n;
  const n0 = countF();
  check("6a. offered on a FAIL to an editor of VeritaResponse, with nothing made by itself", (await call(EDITOR, "GET", G(bad))).j?.canOpen === true && (await call(EDITOR, "GET", G(bad))).j.findings.length === 0 && countF() === n0);
  for (const [what, id] of [["a pass", good], ["a draft", draft], ["a FAIL overridden to PASS", overridden]] as const) {
    const g = await call(EDITOR, "GET", G(id)), o = await call(EDITOR, "POST", O(id), {});
    check(`6b. ${what}: not offered and refused`, g.j?.canOpen === false && o.s === 409 && o.j?.code === "STUDY_NOT_FAILED", `${g.text} ${o.text}`);
  }
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["an editor of VeritaScan only", SCAN_ONLY], ["another customer", OTHER]] as const) {
    const o = await call(u, "POST", O(bad), {}), g = await call(u, "GET", G(bad));
    check(`6c. ${who} is refused and isn't offered it`, o.s === 403 && g.j?.canOpen !== true, `${o.s} ${g.text}`);
  }
  check("6d. another lab's study isn't found through this lab", (await call(OWNER, "POST", O(inB), {})).s === 404 && (await call(OWNER, "GET", G(inB))).s === 404);
  sqlite.prepare("UPDATE labs SET plan = 'veritacheck_only' WHERE id = ?").run(A);
  const noPlan = await call(EDITOR, "POST", O(bad), {}), noOffer = await call(EDITOR, "GET", G(bad));
  sqlite.prepare("UPDATE labs SET plan = 'hospital' WHERE id = ?").run(A);
  check("6d2. a lab whose plan has no VeritaResponse isn't offered it and is refused", noPlan.s === 403 && noPlan.j?.code === "PLAN_REQUIRED" && noOffer.j?.canOpen === false, noPlan.text);
  check("6e. no refusal made a finding", countF() === n0);
  const opened = await call(EDITOR, "POST", O(bad), {});
  const fs = one("SELECT * FROM findings WHERE id = ?", opened.j?.id);
  check("6f. it makes one open internal event with no deadline, naming and linked to the study", opened.s === 201 && fs.source_type === "internal_nce" && fs.accreditor === "Other" && fs.status === "open" && fs.due_date === null && fs.study_id === bad && fs.event_date === "2026-11-20" && fs.discovered_by === "Ed Editor" && fs.user_id === OWNER.id && fs.lab_id === A
    && /study \d+: Glucose, Calibration Verification \/ Linearity, Alphamatic 500, dated 2026-11-20\. The study's result is FAIL\./.test(fs.description), JSON.stringify(fs));
  check("6g. the study names the finding", (await call(STAFF, "GET", G(bad))).j.findings.map((f: any) => f.id).join() === String(fs.id));
  const links = await call(EDITOR, "GET", `/api/labs/${A}/findings/${fs.id}/links`);
  check("6h. the finding names the study", links.j?.study?.id === bad && links.j.study.name === "Glucose, Calibration Verification / Linearity" && links.j.study.status === "fail", links.text);
  const created = JSON.parse(one("SELECT payload FROM finding_history WHERE finding_id = ? AND event = 'created'", fs.id).payload);
  check("6i. its history and the study's audit row say where it came from", created.study_id === bad && w.audits("study_finding", bad).length === 1 && one("SELECT status FROM studies WHERE id = ?", bad).status === "fail");
  const twice = await call(OWNER, "POST", O(bad), {});
  check("6j. a second open finding isn't made for the same study", twice.s === 409 && twice.j?.code === "FINDING_EXISTS" && twice.j.finding_id === fs.id && countF() === n0 + 1);
  sqlite.prepare("UPDATE findings SET status = 'closed' WHERE id = ?").run(fs.id);
  check("6k. once that one is closed, the study can open another", (await call(EDITOR, "POST", O(bad), {})).s === 201);
  check("6l. every ordinary finding has no study", one("SELECT study_id FROM findings WHERE id = ?", f1).study_id === null && (await call(EDITOR, "GET", `/api/labs/${A}/findings/${f1}/links`)).j?.study === null);
  sqlite.prepare("DELETE FROM studies WHERE id = ?").run(bad);
  check("6m. a deleted study leaves the finding readable, with no link", (await call(EDITOR, "GET", `/api/labs/${A}/findings/${fs.id}/links`)).j?.study === null && (await call(EDITOR, "GET", `/api/labs/${A}/findings/${fs.id}`)).s === 200);

  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
