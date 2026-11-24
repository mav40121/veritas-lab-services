// tests/integration/veritascan-carry.test.ts
//
// STANDING integration test for carried answers and bulk answers on VeritaScan (B7, 2026-11-24;
// server/veritascanCarry.ts, server/veritascanItems.ts).
//   1. What can be carried, and what never is (automatic marks and their words, teaching notes, unreviewed carried answers).
//   2. A carried answer raises no percentage anywhere until it is reviewed: scan list, compliance digest, Excel, N/A included.
//   3. Reviewing: giving a status, or setting it aside; a notes save and Veritas support don't; one audit row each.
//   4. Several items set together: one confirmed count, an audit row per item, one email, refusals write nothing.
//   5. Another lab of the same organization: a system owner or admin only, same rules, never across organizations.
//
// Boots the REAL routes against a throwaway SQLite DB (made-up rows only). Run: npm run test:veritascan-carry
import { inspectionWorld } from "./inspectionFixture";

async function main() {
  const w = await inspectionWorld("carry");
  const { A, B, X, ORG, call, check, one, all, sent, sqlite, seed } = w;
  const { OWNER, OTHER, EDITOR, SCAN_ONLY, VIEWER, STAFF, ADMIN_A, LEADER, SUPPORT } = w;
  const { SCAN_ITEMS } = await import("../../client/src/lib/veritaScanData");
  const { digestCountsForLab } = await import("../../server/digestCounts");
  const { default: ExcelJS } = await import("exceljs");
  const TOTAL = SCAN_ITEMS.length;
  const S = (lab: number, id?: number, rest = "") => `/api/labs/${lab}/veritascan/scans${id ? `/${id}${rest}` : ""}`;
  const item = (scan: number, id: number) => one("SELECT * FROM veritascan_items WHERE scan_id = ? AND item_id = ?", scan, id);
  const scansOf = (lab: number) => one("SELECT COUNT(*) AS n FROM veritascan_scans WHERE lab_id = ?", lab).n;
  const listed = async (lab: number, id: number) => (await call(OWNER, "GET", S(lab))).j.find((s: any) => s.id === id);
  const pct = (s: any) => (s.assessedCount > 0 && s.totalItems - s.naCount > 0 ? (s.compliantCount / (s.totalItems - s.naCount)) * 100 : null); // VeritaScanAppPage's rule

  // A finished scan of lab A
  const src = await w.newScan(EDITOR, A, "Made-up Annual 2025");
  const answers: any[] = SCAN_ITEMS.map((i: any) => ({ itemId: i.id, status: "Not Assessed" }));
  const set = (id: number, patch: any) => Object.assign(answers.find((a) => a.itemId === id), patch);
  for (let i = 1; i <= 60; i++) set(i, { status: "Compliant" });
  for (let i = 61; i <= 70; i++) set(i, { status: "N/A" });
  set(1, { notes: "Made-up: binder 3", owner: "Typed Owner", dueDate: "2026-12-15", teachingNote: "Made-up teaching note" });
  set(71, { status: "Needs Attention", notes: "Made-up gap", dueDate: "2026-12-20" });
  set(72, { status: "Immediate Action" });
  set(73, { notes: "Made-up: only a note" });
  await call(EDITOR, "PUT", S(A, src, "/items"), { items: answers });
  await call(EDITOR, "PUT", S(A, src, "/items/2/assignee"), { user_id: STAFF.id });
  const LEFT = await w.login("left", "Lou Left"); w.member(A, LEFT);
  await call(EDITOR, "PUT", S(A, src, "/items/3/assignee"), { user_id: LEFT.id });
  sqlite.prepare("UPDATE lab_members SET status = 'inactive' WHERE lab_id = ? AND user_id = ?").run(A, LEFT.id);
  // Automatic marks and their words
  sqlite.prepare("UPDATE veritascan_items SET completion_source = 'veritacheck_auto', completion_link = '/study/1/results', completion_note = 'Marked Compliant by VeritaCheck® Coverage on 2026-11-01: made-up' WHERE scan_id = ? AND item_id = 21").run(src);
  sqlite.prepare("UPDATE veritascan_items SET completion_source = 'veritacomp_auto', notes = 'Auto-completed by VeritaComp™: made-up', completion_note = 'Auto-completed by VeritaComp™: made-up' WHERE scan_id = ? AND item_id = 60").run(src);
  sqlite.prepare("UPDATE veritascan_items SET completion_source = 'veritacheck_evidence', completion_link = '/study/2/results', completion_note = 'Evidence from VeritaCheck®: made-up', notes = 'Evidence from VeritaCheck®: made-up' WHERE scan_id = ? AND item_id = 4").run(src);
  sqlite.prepare("UPDATE veritascan_items SET completion_source = 'admin_correction', status = 'Not Assessed', notes = 'Veritas Lab Services moved this item back to Not Assessed on 2026-11-06. Made-up.' WHERE scan_id = ? AND item_id = 5").run(src);
  await call(EDITOR, "PUT", S(A, src, "/teaching"), { isTeaching: true, teachingIntro: "Made-up intro" });
  const CQ = seed("veritascan_custom_items", { lab_id: A, question: "Made-up custom", status: "active" });
  await call(EDITOR, "PUT", S(A, src, `/custom-items/${CQ}`), { status: "Compliant" });

  // ── 1. What can be carried ────────────────────────────────────────────────
  const prev = await call(EDITOR, "GET", S(A, src, "/carry-preview"));
  const pIds = (prev.j?.items ?? []).map((i: any) => i.item_id);
  check("1a. answered items and a lone note are offered; an unanswered empty one isn't", prev.s === 200 && [1, 2, 61, 71, 72, 73].every((i) => pIds.includes(i)) && !pIds.includes(100), prev.text.slice(0, 200));
  check("1b. automatic marks are not offered and are counted", !pIds.includes(21) && !pIds.includes(60) && prev.j.notCopied.automatic === 2);
  check("1c. a mark the correction moved back, holding only its own words, isn't offered", !pIds.includes(5));
  check("1d. a lab's own Compliant on an item with a study linked is offered, without the study's words", prev.j.items.find((i: any) => i.item_id === 4)?.notes === null);
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["another customer", OTHER]] as const) {
    check(`1e. ${who} doesn't read the list`, (await call(u, "GET", S(A, src, "/carry-preview"))).s === 403);
  }
  check("1f. another lab's scan isn't found through this lab", (await call(OTHER, "GET", S(X, src, "/carry-preview"))).s === 404);

  const pick = prev.j.items.filter((i: any) => i.status === "Compliant" || i.status === "N/A").map((i: any) => i.item_id).concat([71, 73]);
  sent.length = 0;
  const made = await call(EDITOR, "POST", S(A), { name: "Made-up Annual 2026", carryFrom: { scanId: src, itemIds: pick } });
  const dst = made.j?.id;
  check("1g. the new scan holds the ticked items and a row for every checklist item", made.s === 200 && made.j.carried === pick.length && one("SELECT COUNT(*) AS n FROM veritascan_items WHERE scan_id = ?", dst).n === TOTAL && one("SELECT COUNT(*) AS n FROM veritascan_items WHERE scan_id = ? AND carried_at IS NOT NULL", dst).n === pick.length, made.text);
  const c1 = item(dst, 1), c71 = item(dst, 71);
  check("1h. status waits beside the item; notes, owner and due date come along", c1.status === "Not Assessed" && c1.carried_status === "Compliant" && c1.notes === "Made-up: binder 3" && c1.owner === "Typed Owner" && c1.due_date === "2026-12-15" && c71.carried_status === "Needs Attention" && c71.due_date === "2026-12-20");
  check("1i. marked with the scan's name and date, and who carried it", c1.carried_from_name === "Made-up Annual 2025" && c1.carried_from_scan_id === src && /^\d{4}-\d{2}-\d{2}T/.test(c1.carried_from_date) && c1.carried_by_user_id === EDITOR.id && c1.carried_reviewed_at === null);
  check("1j. never teaching notes, the teaching flag, completion marks, links, or a custom question's answer",
    one("SELECT COUNT(*) AS n FROM veritascan_items WHERE scan_id = ? AND (teaching_note IS NOT NULL OR completion_link IS NOT NULL OR completion_note IS NOT NULL OR COALESCE(completion_source, 'manual') <> 'manual')", dst).n === 0
    && one("SELECT is_teaching, teaching_intro FROM veritascan_scans WHERE id = ?", dst).is_teaching === 0 && one("SELECT COUNT(*) AS n FROM veritascan_custom_item_status WHERE scan_id = ?", dst).n === 0 && item(dst, 4).notes === null);
  check("1k. a person still on the lab stays assigned, one who left is only a name, and no email goes out", item(dst, 2).owner_user_id === STAFF.id && item(dst, 3).owner_user_id === null && item(dst, 3).owner === "Lou Left" && sent.length === 0);
  const items = await call(STAFF, "GET", S(A, dst, "/items"));
  const r1 = items.j.find((i: any) => i.item_id === 1);
  check("1l. the items read says carried, not reviewed, from where", r1.carried_pending === 1 && r1.carried_status === "Compliant" && r1.carried_from_name === "Made-up Annual 2025" && items.j.find((i: any) => i.item_id === 100).carried_pending === 0);
  const cAudit = w.audits("scan_carry", dst);
  check("1m. one audit row for the copy, in the lab owner's trail, naming the items", cAudit.length === 1 && cAudit[0].owner_user_id === OWNER.id && cAudit[0].user_id === EDITOR.id && JSON.parse(cAudit[0].after_json).item_ids.length === pick.length);
  check("1n. the source scan is unchanged", item(src, 1).status === "Compliant" && item(src, 1).carried_at === null && item(src, 1).teaching_note === "Made-up teaching note");
  check("1o. a carried answer nobody reviewed is never carried on", (await call(EDITOR, "GET", S(A, dst, "/carry-preview"))).j.items.length === 0 && (await call(EDITOR, "GET", S(A, dst, "/carry-preview"))).j.notCopied.unreviewed === pick.length);
  const n1 = scansOf(A);
  for (const [what, body] of [
    ["an automatic mark", { name: "x", carryFrom: { scanId: src, itemIds: [1, 21] } }], ["an unreviewed carried answer", { name: "x", carryFrom: { scanId: dst, itemIds: [1] } }],
    ["no items", { name: "x", carryFrom: { scanId: src, itemIds: [] } }], ["no name", { name: " ", carryFrom: { scanId: src, itemIds: [1] } }], ["rubbish ids", { name: "x", carryFrom: { scanId: src, itemIds: ["abc"] } }],
  ] as const) check(`1p. ${what}: refused, no scan made`, (await call(EDITOR, "POST", S(A), body)).s === 400 && scansOf(A) === n1);
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["another customer", OTHER]] as const) {
    check(`1q. ${who} can't begin one`, (await call(u, "POST", S(A), { name: "x", carryFrom: { scanId: src, itemIds: [1] } })).s === 403 && scansOf(A) === n1);
  }
  check("1r. a plain new scan is as before", (await call(EDITOR, "POST", S(A), { name: "Made-up Blank" })).j?.carried === undefined && one("SELECT COUNT(*) AS n FROM veritascan_items WHERE scan_id = (SELECT MAX(id) FROM veritascan_scans WHERE lab_id = ?)", A).n === 0);

  // ── 2. No percentage moves until reviewed ─────────────────────────────────
  const l0 = await listed(A, dst);
  check("2a. the scan list reads 0 compliant, 0 N/A, 0 assessed of the whole checklist", l0.compliantCount === 0 && l0.naCount === 0 && l0.assessedCount === 0 && l0.totalItems === TOTAL && pct(l0) === null, JSON.stringify(l0));
  const digestScan = () => { sqlite.prepare("UPDATE veritascan_scans SET updated_at = ? WHERE id = ?").run(new Date(Date.now() + 60000).toISOString(), dst); return (digestCountsForLab(sqlite, A, "2026-11-01", "2026-11-30") as any).scan; };
  const d0 = digestScan();
  check("2b. the compliance digest reads the same", d0?.scanId === dst && d0.compliant === 0 && d0.na === 0 && d0.assessed === 0, JSON.stringify(d0));
  const referenceItems = SCAN_ITEMS.map((i: any) => ({ id: i.id, domain: i.domain, question: i.question, cfr: i.cfr }));
  const xlsx = async () => {
    const r = await call(EDITOR, "POST", `/api/labs/${A}/veritascan/excel/${dst}`, { referenceItems });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf as any);
    const ws = wb.getWorksheet("VeritaScan")!;
    const rows: Record<number, { status: string; notes: string }> = {};
    let head: string[] = [];
    ws.eachRow((row) => { const v = (row.values as any[]).map((x) => String(x?.richText ? x.richText.map((t: any) => t.text).join("") : x ?? "")); if (v.includes("Status")) head = v; else if (head.length && Number(v[1])) rows[Number(v[1])] = { status: v[head.indexOf("Status")], notes: v[head.indexOf("Notes")] }; });
    return rows;
  };
  const x0 = await xlsx();
  check("2c. the Excel export reads Not Assessed and says where it came from", x0[1]?.status === "Not Assessed" && /^Carried from Made-up Annual 2025, \d{4}-\d{2}-\d{2}, not yet reviewed \(answer there: Compliant\)\. Made-up: binder 3$/.test(x0[1]?.notes ?? ""), JSON.stringify(x0[1]));
  check("2d. no row of it reads Compliant or N/A", Object.values(x0).length === TOTAL && !Object.values(x0).some((r) => r.status === "Compliant" || r.status === "N/A"));
  // A study passing in the lab still links itself as evidence and doesn't turn the carried answer into an answer.
  const { linkVeritaCheckEvidence } = await import("../../server/integrations");
  linkVeritaCheckEvidence({ id: 9, userId: OWNER.id, labId: A, status: "pass", studyType: "precision", testName: "Glucose" } as any);
  check("2e. evidence linked by a passing study leaves every carried answer unreviewed and uncounted", (await listed(A, dst)).compliantCount === 0 && one("SELECT COUNT(*) AS n FROM veritascan_items WHERE scan_id = ? AND carried_reviewed_at IS NOT NULL", dst).n === 0);

  // ── 3. Reviewing ──────────────────────────────────────────────────────────
  const rows = async () => (await call(EDITOR, "GET", S(A, dst, "/items"))).j as any[];
  const body = (rs: any[], patch: Record<number, any> = {}) => ({ items: rs.map((r) => ({ itemId: r.item_id, status: r.status, notes: r.notes ?? "", owner: r.owner ?? "", dueDate: r.due_date ?? "", ...(patch[r.item_id] ?? {}) })) });
  await call(EDITOR, "PUT", S(A, dst, "/items"), body(await rows(), { 1: { notes: "Made-up: edited, not answered" } }));
  check("3a. saving notes on it isn't a review", item(dst, 1).carried_reviewed_at === null && item(dst, 1).notes === "Made-up: edited, not answered" && (await listed(A, dst)).compliantCount === 0);
  const one1 = await call(EDITOR, "PUT", S(A, dst, "/items"), body(await rows(), { 1: { status: "Compliant" } }));
  check("3b. giving it a status is: who and when are kept, and it counts from here", one1.s === 200 && item(dst, 1).carried_reviewed_by_user_id === EDITOR.id && !!item(dst, 1).carried_reviewed_at && item(dst, 1).status === "Compliant" && (await listed(A, dst)).compliantCount === 1);
  await call(EDITOR, "PUT", S(A, dst, "/items"), body(await rows()));
  const a1 = w.audits("veritascan_item", item(dst, 1).id);
  check("3c. one audit row for the review, before and after, however many saves follow", a1.length === 1 && JSON.parse(a1[0].before_json).carried_status === "Compliant" && JSON.parse(a1[0].after_json).status === "Compliant" && a1[0].user_id === EDITOR.id && a1[0].owner_user_id === OWNER.id);
  check("3d. the list's percent is the honest one: 1 of the whole checklist", Math.abs(pct(await listed(A, dst))! - 100 / TOTAL) < 1e-9);
  await call(EDITOR, "PUT", S(A, dst, "/items/61"), { status: "N/A" });
  check("3e. a reviewed N/A leaves the denominator, and only then", (await listed(A, dst)).naCount === 1 && item(dst, 61).carried_reviewed_by_user_id === EDITOR.id && item(dst, 62).carried_reviewed_at === null);
  await call(EDITOR, "PUT", S(A, dst, "/items"), body(await rows(), { 2: { clearCarried: true, notes: "", owner: "", dueDate: "" } }));
  check("3f. setting one aside: Not Assessed, reviewed, the person it brought is gone, one audit row", item(dst, 2).status === "Not Assessed" && !!item(dst, 2).carried_reviewed_at && item(dst, 2).owner_user_id === null && item(dst, 2).owner === null && w.audits("veritascan_item", item(dst, 2).id).length === 1 && (await rows()).find((r) => r.item_id === 2).carried_pending === 0);
  // Veritas support works in the scan but doesn't answer a carried item for the lab.
  const sup = await call(SUPPORT, "PUT", S(A, dst, "/items"), body(await rows(), { 6: { status: "Compliant" }, 7: { clearCarried: true }, 100: { status: "Needs Attention" } }));
  check("3g. support's save leaves carried items as they were and says which; other items save as before", sup.s === 200 && sup.j.carriedHeld.sort().join() === "6,7" && item(dst, 6).status === "Not Assessed" && item(dst, 6).carried_reviewed_at === null && item(dst, 7).carried_reviewed_at === null && item(dst, 100).status === "Needs Attention", sup.text);
  const sup1 = await call(SUPPORT, "PUT", S(A, dst, "/items/6"), { status: "Compliant" });
  check("3h. the same on one item", sup1.j?.carriedHeld?.join() === "6" && item(dst, 6).status === "Not Assessed" && item(dst, 6).carried_reviewed_at === null);
  check("3i. support may begin a scan from an earlier one of the same lab (setup)", (await call(SUPPORT, "POST", S(A), { name: "Made-up Support Setup", carryFrom: { scanId: src, itemIds: [1] } })).s === 200);
  for (const [who, u] of [["a Staff login", STAFF], ["a view-only reviewer", VIEWER], ["another customer", OTHER]] as const) {
    check(`3j. ${who} can't review`, (await call(u, "PUT", S(A, dst, "/items/6"), { status: "Compliant" })).s === 403 && item(dst, 6).carried_reviewed_at === null);
  }

  // ── 4. Several items together ─────────────────────────────────────────────
  const bulk = (u: any, b: any, id = dst, lab = A) => call(u, "POST", S(lab, id, "/items/bulk-set"), b);
  const snap = () => JSON.stringify(all("SELECT item_id, status, owner, owner_user_id, due_date, carried_reviewed_at FROM veritascan_items WHERE scan_id = ? ORDER BY item_id", dst));
  sent.length = 0;
  const s0 = snap();
  for (const [what, b, want, code] of [
    ["a count that isn't what was sent", { item_ids: [10, 11], status: "Compliant", expected_count: 3 }, 409, "COUNT_CHANGED"], ["no count", { item_ids: [10], status: "Compliant" }, 409, "COUNT_CHANGED"],
    ["no items", { item_ids: [], status: "Compliant", expected_count: 0 }, 400, "NO_ITEMS"], ["nothing to set", { item_ids: [10], expected_count: 1 }, 400, "NOTHING_TO_SET"],
    ["a status that isn't one", { item_ids: [10], status: "Great", expected_count: 1 }, 400, "STATUS_INVALID"], ["a due date that isn't a date", { item_ids: [10], due_date: "soon", expected_count: 1 }, 400, "DUE_DATE_INVALID"],
    ["an item that isn't on the checklist", { item_ids: [10, 99999], status: "Compliant", expected_count: 2 }, 400, "ITEM_UNKNOWN"], ["a person outside the lab", { item_ids: [10], owner_user_id: OTHER.id, expected_count: 1 }, 400, "ASSIGNEE_NOT_ON_LAB"],
    ["a person and a typed name", { item_ids: [10], owner_user_id: EDITOR.id, owner: "x", expected_count: 1 }, 400, "OWNER_INVALID"],
  ] as const) { const r = await bulk(EDITOR, b); check(`4a. ${what}: refused`, r.s === want && r.j?.code === code, `${r.s} ${r.text}`); }
  for (const [who, u, want] of [["a Staff login", STAFF, 403], ["a view-only reviewer", VIEWER, 403], ["another customer", OTHER, 403]] as const) {
    check(`4b. ${who} is refused`, (await bulk(u, { item_ids: [10], status: "Compliant", expected_count: 1 })).s === want);
  }
  check("4c. another lab's scan isn't found through this lab", (await bulk(OTHER, { item_ids: [10], status: "Compliant", expected_count: 1 }, dst, X)).s === 404);
  const supPerson = await bulk(SUPPORT, { item_ids: [120], owner_user_id: EDITOR.id, expected_count: 1 }), supReview = await bulk(SUPPORT, { item_ids: [10, 120], status: "Compliant", expected_count: 2 });
  check("4d. support can't assign or review a carried answer through it", supPerson.s === 403 && supPerson.j?.code === "VLS_SUPPORT_CANNOT_SIGN" && supReview.s === 403 && supReview.j?.code === "VLS_SUPPORT_CANNOT_SIGN");
  check("4e. no refusal wrote or mailed anything", snap() === s0 && sent.length === 0);
  const ids = [10, 11, 12, 120, 121];
  const au = (i: number) => w.audits("veritascan_item", item(dst, i).id);
  const ok = await bulk(SCAN_ONLY, { item_ids: ids, status: "Needs Attention", due_date: "2027-01-15", owner_user_id: STAFF.id, expected_count: 5 });
  check("4f. status, person and due date land on all five", ok.s === 200 && ok.j.count === 5 && ids.every((i) => { const r = item(dst, i); return r.status === "Needs Attention" && r.due_date === "2027-01-15" && r.owner_user_id === STAFF.id && r.owner === "Stef Staff"; }), ok.text);
  check("4g. one email for all of them, with the due date", sent.length === 1 && sent[0].to === STAFF.email && /5 VeritaScan items/.test(sent[0].subject) && sent[0].html.includes("2027-01-15"), JSON.stringify(sent.map((m) => m.subject)));
  check("4h. each item has its own audit rows with before and after", ids.every((i) => { const rs = au(i); return rs.some((r) => JSON.parse(r.after_json).due_date === "2027-01-15" && JSON.parse(r.before_json).status === "Not Assessed" && r.user_id === SCAN_ONLY.id) && rs.some((r) => JSON.parse(r.after_json).owner_user_id === STAFF.id); }));
  check("4i. the three carried ones are reviewed by it, with their own row; the others never were carried", ok.j.reviewed === 3 && [10, 11, 12].every((i) => item(dst, i).carried_reviewed_by_user_id === SCAN_ONLY.id && au(i).some((r) => /carried answer reviewed/.test(r.entity_label))) && item(dst, 120).carried_at === null);
  const before = au(10).length;
  const same = await bulk(SCAN_ONLY, { item_ids: ids, status: "Needs Attention", due_date: "2027-01-15", owner_user_id: STAFF.id, expected_count: 5 });
  check("4j. the same again changes nothing: no audit row, no email", same.s === 200 && same.j.updated === 0 && same.j.assigned === 0 && au(10).length === before && sent.length === 1);
  await bulk(EDITOR, { item_ids: [13, 14], owner: "Typed Together", due_date: "2027-02-01", expected_count: 2 });
  check("4k. an owner and a due date alone leave a carried answer unreviewed", [13, 14].every((i) => item(dst, i).owner === "Typed Together" && item(dst, i).carried_reviewed_at === null && item(dst, i).status === "Not Assessed"));
  await bulk(EDITOR, { item_ids: [10, 120], owner: "Typed Over", expected_count: 2 });
  await bulk(EDITOR, { item_ids: [11, 121], owner_user_id: null, due_date: null, expected_count: 2 });
  check("4l. a typed name replaces a person; clearing empties owner and due date", item(dst, 10).owner === "Typed Over" && item(dst, 10).owner_user_id === null && item(dst, 11).owner === null && item(dst, 11).owner_user_id === null && item(dst, 11).due_date === null && item(dst, 11).status === "Needs Attention");
  const fresh = await w.newScan(EDITOR, A, "Made-up Fresh");
  await bulk(EDITOR, { item_ids: [1, 2, 3], status: "Compliant", expected_count: 3 }, fresh);
  check("4m. three answers on a fresh scan read 3 of the whole checklist, not 100%", (await listed(A, fresh)).totalItems === TOTAL && Math.abs(pct(await listed(A, fresh))! - 300 / TOTAL) < 1e-9);
  check("4n. support may set several items that aren't carried (setup)", (await bulk(SUPPORT, { item_ids: [130], status: "Needs Attention", expected_count: 1 })).s === 200 && item(dst, 130).status === "Needs Attention");

  // ── 5. Another lab ────────────────────────────────────────────────────────
  const targets = async (u: any, lab = A) => (await call(u, "GET", `/api/labs/${lab}/veritascan/copy-targets`)).j;
  check("5a. a system admin is offered the organization's other lab and nothing else", (await targets(LEADER)).allowed === true && (await targets(LEADER)).labs.map((l: any) => l.id).join() === String(B), JSON.stringify(await targets(LEADER)));
  for (const [who, u] of [["the lab's owner with no system role", OWNER], ["the lab's admin", ADMIN_A], ["an editor", EDITOR], ["a Staff login", STAFF], ["Veritas support", SUPPORT]] as const) {
    check(`5b. ${who} is offered none`, (await targets(u))?.allowed === false && (await targets(u))?.labs.length === 0);
  }
  const copy = (u: any, target: number, from = src, itemIds: any[] = [1, 2, 61, 71]) => call(u, "POST", S(target), { name: "Made-up Copy", carryFrom: { scanId: from, itemIds } });
  const nB = scansOf(B), nX = scansOf(X);
  const OTHER_ORG = seed("organizations", { name: "Made-up Other System", billing_owner_user_id: OTHER.id, plan: "enterprise" });
  sqlite.prepare("UPDATE labs SET organization_id = ? WHERE id = ?").run(OTHER_ORG, X);
  const TWO = await w.login("two", "Terry Two"); for (const o of [ORG, OTHER_ORG]) seed("organization_members", { organization_id: o, user_id: TWO.id, org_role: "org_admin", status: "active" });
  const OLD = await w.login("old", "Oz Old"); seed("organization_members", { organization_id: ORG, user_id: OLD.id, org_role: "org_admin", status: "inactive" });
  for (const [who, u, target, want] of [
    ["the owner of both labs with no system role", OWNER, B, 404], ["the source lab's admin", ADMIN_A, B, 403], ["an editor", EDITOR, B, 403], ["a Staff login", STAFF, B, 403], ["Veritas support", SUPPORT, B, 404],
    ["a former system admin", OLD, B, 403], ["another customer, into their own lab", OTHER, X, 404], ["an admin of both organizations, across them", TWO, X, 404],
  ] as const) {
    const r = await copy(u, target);
    check(`5c. ${who}: refused`, r.s === want && !r.text.includes("Made-up Annual"), `${r.s} ${r.text.slice(0, 100)}`);
  }
  // A member of both labs who is an editor in each still isn't a system owner or admin.
  w.member(B, EDITOR); w.seat(OWNER.id, EDITOR, B);
  check("5d. an editor of both labs with no system role: refused", (await copy(EDITOR, B)).s === 404);
  check("5e. no refusal made a scan", scansOf(B) === nB && scansOf(X) === nX);
  sent.length = 0;
  const done = await copy(LEADER, B);
  const cp = done.j?.id;
  check("5f. a system admin's copy is a new scan in the other lab, same marks, naming the lab it came from", done.s === 200 && one("SELECT lab_id FROM veritascan_scans WHERE id = ?", cp).lab_id === B && item(cp, 1).status === "Not Assessed" && item(cp, 1).carried_status === "Compliant" && item(cp, 1).carried_from_name === "Made-up Annual 2025, Made-up Lab A", done.text);
  check("5g. a person who isn't on that lab comes along as a name only, and no one is mailed", item(cp, 2).owner === "Stef Staff" && item(cp, 2).owner_user_id === null && sent.length === 0);
  check("5h. and nothing counts there until reviewed", (await listed(B, cp)).compliantCount === 0 && (await listed(B, cp)).naCount === 0 && (await listed(B, cp)).totalItems === TOTAL);
  check("5i. an automatic mark is refused here too", (await copy(LEADER, B, src, [21])).s === 400);
  check("5j. the copy is in the audit trail, with both labs", w.audits("scan_carry", cp).length === 1 && JSON.parse(w.audits("scan_carry", cp)[0].after_json).from_lab_id === A && JSON.parse(w.audits("scan_carry", cp)[0].after_json).lab_id === B);
  check("5k. evidence and custom questions stay with their lab", one("SELECT COUNT(*) AS n FROM veritascan_custom_item_status WHERE scan_id = ?", cp).n === 0 && one("SELECT COUNT(*) AS n FROM veritascan_items WHERE scan_id = ? AND completion_link IS NOT NULL", cp).n === 0);
  sqlite.prepare("UPDATE labs SET retired_at = ? WHERE id = ?").run(w.now, A);
  check("5l. a retired lab's scan isn't copied from", (await copy(LEADER, B)).s === 404);
  sqlite.prepare("UPDATE labs SET retired_at = NULL, organization_id = NULL WHERE id = ?").run(A);
  check("5m. a lab with no organization isn't copied from", (await copy(LEADER, B)).s === 404 && (await copy(TWO, B)).s === 404);

  w.finish();
}

main().catch((e) => { console.error(e); process.exit(1); });
