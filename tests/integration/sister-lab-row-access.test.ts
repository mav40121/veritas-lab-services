// tests/integration/sister-lab-row-access.test.ts
//
// Michael 2026-11-06, Q191 = 1. A seat used to reach every record its owner holds, in any of the owner's labs, so a Staff login in lab A
// could open lab B's assessment. Matching the record's owner now counts only for the owner themself, a record with no lab, a seat in
// that record's lab, or an older seat with no lab on it. An older seat whose holder has no active membership anywhere keeps today's
// behavior; a new seat can never fall into that. Both lab resolvers follow the same rule, so naming a sister lab in the header doesn't
// get anyone in. Boots the REAL routes on a scratch DB with made-up people.
// Run: npm run test:sister-lab-row-access
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };
const OLD_DATE = "2026-03-01T12:00:00.000Z";

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { OLDER_SEAT_BEFORE, isOlderSeatDate, ownerMatchCounts, resolveRowForMutation, resolveLegacyLabId } = await import("../../server/labAccessGuard");
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
  const call = async (method: string, path: string, body: unknown, token: string, labHeader?: number) => {
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
    if (labHeader) headers["X-Active-Lab-Id"] = String(labHeader);
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string, inviteToken?: string) => {
    const email = `sis-${tag.toLowerCase()}-${stamp}@example.test`;
    const reg = (await (await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true, ...(inviteToken ? { inviteToken } : {}) }) })).json()) as any;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
  };
  const provision = async (email: string, labName: string) => Number(((await (await fetch(`${base}/api/admin/provision-demo-lab`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: ADMIN, ownerEmail: email, labName, plan: "hospital" }) })).json()) as any).labId);
  const seed = (table: string, values: Record<string, any>): number => {
    const row: Record<string, any> = { ...values };
    for (const c of sqlite.prepare(`PRAGMA table_info(${table})`).all() as any[]) {
      if (c.notnull && c.dflt_value == null && !c.pk && !(c.name in row)) row[c.name] = /_at$/.test(c.name) ? now : /INT|REAL/.test(String(c.type)) ? 0 : "x";
    }
    const cols = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((k) => row[k])).lastInsertRowid);
  };
  const member = (lab: number, userId: number, role = "staff", status = "active") => sqlite.prepare(
    `INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, ?, '{}', ?, 0, ?, ?, ?)`
  ).run(lab, userId, role, status, now, now, now);
  let seatNo = 0;
  const seat = (ownerId: number, u: { id: number; email: string }, lab: number | null, opts: { type?: string; since?: string | null; perms?: string; roster?: number | null; status?: string } = {}) => seed("user_seats", {
    owner_user_id: ownerId, seat_email: u.email, seat_user_id: u.id,
    invited_at: opts.since === undefined ? now : opts.since, accepted_at: opts.since === undefined ? now : opts.since,
    status: opts.status ?? "active", permissions: opts.perms ?? '{"mode":"edit_all"}', invite_token: `sis-${stamp}-${++seatNo}`,
    lab_id: lab, seat_type: opts.type ?? "active", staff_employee_id: opts.roster ?? null,
  });

  try {
    // ── An owner with three labs, and another customer ────────────────────────
    const OWNER = await register("Owner"), OTHER = await register("Other");
    const home = await provision(OWNER.email, "Made-up Home Lab"), other = await provision(OTHER.email, "Made-up Other Customer");
    const sibling = (name: string) => Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, plan, subscription_status, subscription_expires_at, created_at, updated_at) SELECT ?, owner_user_id, plan, subscription_status, subscription_expires_at, ?, ? FROM labs WHERE id = ?").run(name, now, now, home).lastInsertRowid);
    const labA = sibling("Made-up Lab A"), labB = sibling("Made-up Lab B");
    member(labA, OWNER.id, "owner"); member(labB, OWNER.id, "owner");
    sqlite.prepare("UPDATE users SET lab_id = ?, default_lab_id = ? WHERE id = ?").run(home, home, OWNER.id);
    sqlite.prepare("UPDATE labs SET plan = 'hospital', subscription_status = 'active' WHERE id IN (?, ?)").run(labA, labB);

    // One of each kind of record in a lab.
    const made = (lab: number | null, owner = OWNER.id, tag = lab ?? "nolab") => {
      const ownerAndLab = { user_id: owner, lab_id: lab };
      const program = seed("competency_programs", { ...ownerAndLab, name: `Program ${tag}` });
      const employee = seed("competency_employees", { ...ownerAndLab, name: `Made Up Tech ${tag}` });
      const assessment = seed("competency_assessments", { program_id: program, employee_id: employee, assessment_date: "2026-10-15", evaluator_name: "Made Up Evaluator", status: "pass", assessment_type: "annual", created_at: now });
      return {
        program, assessment,
        map: seed("veritamap_maps", { ...ownerAndLab, name: `Map ${tag}` }),
        finding: seed("findings", { ...ownerAndLab, accreditor: "CMS", standard_ref: `493.${tag}`, finding_number: `F${tag}` }),
        scan: seed("veritascan_scans", { ...ownerAndLab, name: `Scan ${tag}` }),
        cert: seed("lab_certificates", { ...ownerAndLab, cert_name: `Cert ${tag}`, is_active: 1 }),
        policy: seed("veritapolicy_lab_policies", { ...ownerAndLab }),
        study: seed("studies", { ...ownerAndLab, test_name: `Study ${tag}`, instrument: "x", analyst: "x", date: "2026-10-15", study_type: "precision", clia_allowable_error: 0.1, data_points: "[]", instruments: "[]", status: "completed", created_at: now }),
        task: seed("veritatrack_tasks", { ...ownerAndLab, name: `Task ${tag}`, category: "Maintenance", frequency: "Monthly", frequency_months: 1, active: 1, created_at: now, updated_at: now }),
        verification: seed("veritacheck_verifications", { ...ownerAndLab, instrument_name: `Verification ${tag}`, trigger_type: "new_instrument" }),
        staffing: seed("staffing_studies", { account_id: owner, lab_id: lab, name: `Staffing ${tag}` }),
        cost: seed("veritaops_test_cost_studies", { account_id: owner, lab_id: lab, test_name: `Cost ${tag}` }),
        item: seed("inventory_items", { account_id: owner, lab_id: lab, item_name: `Item ${tag}` }),
      };
    };
    const inA = made(labA), inB = made(labB), inHome = made(home), noLab = made(null), inOther = made(other, OTHER.id, "other");
    type Rows = ReturnType<typeof made>;
    const allowed = (s: number) => s !== 403 && s !== 404;
    const refused = (s: number) => s === 403 || s === 404;

    const READS: Array<[string, (r: Rows) => string]> = [
      ["program (userCanAccessLabRow)", (r) => `/api/competency/programs/${r.program}`],
      ["assessment", (r) => `/api/veritacomp/assessments/${r.assessment}`],
      ["assessment PDF", (r) => `/api/veritacomp/assessments/${r.assessment}/pdf`],
      ["map (userCanAccessMap)", (r) => `/api/veritamap/maps/${r.map}`],
      ["finding (userCanAccessFinding)", (r) => `/api/findings/${r.finding}`],
      ["scan (userCanAccessScan)", (r) => `/api/veritascan/scans/${r.scan}`],
      ["certificate (userCanAccessCertificate)", (r) => `/api/veritalab/certificates/${r.cert}/documents`],
      ["study", (r) => `/api/studies/${r.study}`],
      ["staffing study", (r) => `/api/staffing-studies/${r.staffing}`],
    ];
    const WRITES: Array<[string, string, (r: Rows) => string, unknown]> = [
      ["task, through resolveRowForMutation", "PUT", (r) => `/api/veritatrack/tasks/${r.task}`, { name: "Renamed", frequency: "Monthly" }],
      ["verification, through resolveRowForMutation", "PATCH", (r) => `/api/veritacheck/verifications/${r.verification}`, { status: "in_progress" }],
      ["cost study, through resolveRowForMutation on account_id", "PUT", (r) => `/api/veritaops/studies/${r.cost}`, { test_name: "Renamed" }],
      ["inventory item", "PUT", (r) => `/api/inventory/${r.item}`, { item_name: "Renamed" }],
      ["assessment", "PUT", (r) => `/api/competency/assessments/${r.assessment}`, { status: "pass" }],
      ["assessment sign", "POST", (r) => `/api/competency/assessments/${r.assessment}/sign`, {}],
      ["staffing study", "POST", (r) => `/api/staffing-studies/${r.staffing}/data`, {}],
    ];
    // GET /api/studies/:id has always refused anyone naming a lab they hold no seat in, so with the header that one stays refused.
    const expectReads = (who: string, token: string, rows: Rows, where: string, want: "open" | "refused", header?: number) => Promise.all(READS.filter(([name]) => !(header && want === "open" && name === "study")).map(async ([name, url]) => {
      const r = await call("GET", url(rows), undefined, token, header);
      check(`${who}: ${name} in ${where}${header ? ", header naming it" : ""}: ${want}`, want === "open" ? allowed(r.s) : refused(r.s), `${r.s}`);
    }));
    const expectWrites = (who: string, token: string, rows: Rows, where: string, want: "open" | "refused", header?: number) => Promise.all(WRITES.map(async ([name, method, url, body]) => {
      const r = await call(method, url(rows), body, token, header);
      check(`${who}: write ${name} in ${where}${header ? ", header naming it" : ""}: ${want}`, want === "open" ? allowed(r.s) : refused(r.s), `${r.s} ${want === "refused" ? r.text.slice(0, 80) : ""}`);
    }));

    // The row guard alone, for a seat the module edit gate stops first whatever the row: that gate goes by the active lab, and didn't change.
    const guardWrites = (who: string, userId: number, rows: Rows, where: string, want: 200 | 403) => {
      const req = { userId, ownerUserId: OWNER.id };
      for (const [name, table, id, opts] of [["task", "veritatrack_tasks", rows.task, {}], ["verification", "veritacheck_verifications", rows.verification, {}], ["cost study", "veritaops_test_cost_studies", rows.cost, { ownerColumn: "account_id" as const }]] as const) {
        const got = resolveRowForMutation(sqlite, table, id, req, opts);
        check(`${who}: resolveRowForMutation on the ${name} in ${where}: ${want}`, got.status === want && (want === 200) === !!got.row, `${got.status}`);
      }
    };

    // ── The owner themself ───────────────────────────────────────────────────
    await expectReads("owner", OWNER.token, inB, "any of their labs", "open");
    await expectWrites("owner", OWNER.token, inB, "any of their labs", "open");
    // And where they hold no membership row, so only the owner match can open it.
    const labD = sibling("Made-up Lab D");
    sqlite.prepare("UPDATE labs SET plan = 'hospital', subscription_status = 'active' WHERE id = ?").run(labD);
    const inD = made(labD);
    await expectReads("owner, no membership row in the lab", OWNER.token, inD, "their own lab", "open");
    await expectWrites("owner, no membership row in the lab", OWNER.token, inD, "their own lab", "open");

    // ── An editor seat and a Staff login in lab A, both members of it ─────────
    const EDITOR = await register("Editor"), STAFF = await register("Staff");
    const staffRoster = seed("staff_employees", { user_id: OWNER.id, tier2_lab_id: labA, lab_id: seed("staff_labs", { user_id: OWNER.id, tier2_lab_id: labA, lab_name: "Made-up Lab A", clia_number: "11D7654393" }), last_name: "Tech", first_name: "Made", status: "active", created_at: now, updated_at: now });
    member(labA, EDITOR.id); seat(OWNER.id, EDITOR, labA);
    member(labA, STAFF.id); seat(OWNER.id, STAFF, labA, { type: "staff_portal", perms: '{"mode":"view_all"}', roster: staffRoster });
    sqlite.prepare("UPDATE users SET default_lab_id = ? WHERE id IN (?, ?)").run(labA, EDITOR.id, STAFF.id);

    await expectReads("editor in lab A", EDITOR.token, inA, "lab A", "open");
    await expectWrites("editor in lab A", EDITOR.token, inA, "lab A", "open");
    await expectReads("editor in lab A", EDITOR.token, inB, "sister lab B", "refused");
    await expectWrites("editor in lab A", EDITOR.token, inB, "sister lab B", "refused");
    await expectReads("editor in lab A", EDITOR.token, inB, "sister lab B", "refused", labB);
    await expectWrites("editor in lab A", EDITOR.token, inB, "sister lab B", "refused", labB);
    await expectReads("editor in lab A", EDITOR.token, inHome, "the owner's home lab", "refused");

    // The case Michael named: a Staff login in lab A on lab B's assessment.
    for (const [label, header] of [["no header", undefined], ["header naming lab B", labB]] as const) {
      for (const [route, url, method] of [["read", `/api/veritacomp/assessments/${inB.assessment}`, "GET"], ["PDF", `/api/veritacomp/assessments/${inB.assessment}/pdf`, "GET"], ["POST PDF", `/api/competency/pdf/${inB.assessment}`, "POST"]] as const) {
        const r = await call(method, url, method === "POST" ? {} : undefined, STAFF.token, header);
        check(`Staff login in lab A, lab B's assessment, ${route}, ${label}: refused`, refused(r.s) && !r.text.includes("Made Up Tech"), `${r.s}`);
      }
      const prog = await call("GET", `/api/competency/programs/${inB.program}`, undefined, STAFF.token, header);
      check(`Staff login in lab A, lab B's program, ${label}: refused`, refused(prog.s), `${prog.s}`);
    }

    // ── The compliance digest (server/digestIssues.ts): an issue opens only through its own lab's path ──────────
    const digestIn = (lab: number, note: string) => seed("digest_issues", {
      lab_id: lab, period_start: "2026-09-01", period_end: "2026-09-30", status: "published", note, sections: '["findings"]', audience: "staff",
      counts_json: '{"monthStart":"2026-09-01","monthEnd":"2026-09-30","findings":{"open":0,"pastDue":0}}', counts_as_of: now,
    });
    const digestA = digestIn(labA, "Made-up lab A digest"), digestB = digestIn(labB, "Made-up lab B digest");
    for (const [who, token] of [["editor in lab A", EDITOR.token], ["Staff login in lab A", STAFF.token]] as const) {
      const own = await call("GET", `/api/labs/${labA}/digest/issues/${digestA}`, undefined, token);
      check(`${who}: lab A's published staff digest issue opens`, own.s === 200 && own.j.note === "Made-up lab A digest", `${own.s}`);
      for (const [label, header] of [["no header", undefined], ["header naming lab B", labB]] as const) {
        for (const suffix of ["", "/acks"]) {
          const viaA = await call("GET", `/api/labs/${labA}/digest/issues/${digestB}${suffix}`, undefined, token, header);
          const viaB = await call("GET", `/api/labs/${labB}/digest/issues/${digestB}${suffix}`, undefined, token, header);
          check(`${who}: sister lab B's digest issue${suffix}, ${label}: 404 through lab A's path, refused through lab B's`,
            viaA.s === 404 && refused(viaB.s) && !viaA.text.includes("lab B digest") && !viaB.text.includes("lab B digest"), `${viaA.s}/${viaB.s}`);
        }
      }
      const listA = await call("GET", `/api/labs/${labA}/digest/issues`, undefined, token, labB);
      check(`${who}: lab A's digest list, header naming lab B, holds only lab A's issue`, listA.s === 200 && listA.j.issues.map((i: any) => i.id).join() === String(digestA), listA.text.slice(0, 120));
    }
    const ownerDigestB = await call("GET", `/api/labs/${labB}/digest/issues/${digestB}`, undefined, OWNER.token);
    check("owner: sister lab B's digest issue opens through lab B's path", ownerDigestB.s === 200 && ownerDigestB.j.note === "Made-up lab B digest", `${ownerDigestB.s}`);

    // ── A record with no lab: the owner match counts ──────────────────────────
    await expectReads("editor in lab A", EDITOR.token, noLab, "a record with no lab", "open");
    await expectWrites("editor in lab A", EDITOR.token, noLab, "a record with no lab", "open");

    // ── A seat in the record's lab with no membership there ───────────────────
    const SEATONLY = await register("Seatonly");
    member(other, SEATONLY.id); seat(OWNER.id, SEATONLY, labA);
    check("setup: a seat in lab A whose only membership is at another customer", ownerMatchCounts(sqlite, SEATONLY.id, OWNER.id, labA) && !ownerMatchCounts(sqlite, SEATONLY.id, OWNER.id, labB));
    await expectReads("seat in lab A, member elsewhere", SEATONLY.token, inA, "lab A", "open");
    guardWrites("seat in lab A, member elsewhere", SEATONLY.id, inA, "lab A", 200);
    await expectReads("seat in lab A, member elsewhere", SEATONLY.token, inB, "sister lab B", "refused");
    guardWrites("seat in lab A, member elsewhere", SEATONLY.id, inB, "sister lab B", 403);

    // ── Seats in two of the owner's labs ──────────────────────────────────────
    const TWOSEATS = await register("Twoseats");
    member(labA, TWOSEATS.id); seat(OWNER.id, TWOSEATS, labA); seat(OWNER.id, TWOSEATS, labB);
    await expectReads("seats in labs A and B", TWOSEATS.token, inB, "lab B", "open");
    await expectReads("seats in labs A and B", TWOSEATS.token, inHome, "the owner's home lab", "refused");

    // ── A member of B whose seat is in A: the membership opens B, the seat doesn't ──
    const MIXED = await register("Mixed");
    member(labA, MIXED.id); member(labB, MIXED.id); seat(OWNER.id, MIXED, labA);
    await expectReads("seat in lab A, member of lab B", MIXED.token, inB, "lab B", "open");
    await expectWrites("seat in lab A, member of lab B", MIXED.token, inB, "lab B", "open");
    await expectReads("seat in lab A, member of lab B", MIXED.token, inHome, "the owner's home lab", "refused");

    // ── An older seat with no lab on it keeps the owner match ─────────────────
    const OLDNOLAB = await register("Oldnolab");
    member(labA, OLDNOLAB.id); seat(OWNER.id, OLDNOLAB, null, { since: OLD_DATE });
    await expectReads("older seat with no lab", OLDNOLAB.token, inB, "lab B", "open");
    guardWrites("older seat with no lab", OLDNOLAB.id, inB, "lab B", 200);
    await expectReads("older seat with no lab", OLDNOLAB.token, inB, "lab B", "open", labB);
    const OLDNULL = await register("Oldnull");
    member(labA, OLDNULL.id); seat(OWNER.id, OLDNULL, null, { since: null });
    await expectReads("seat with no lab and no dates", OLDNULL.token, inB, "lab B", "open");

    // ── The exemption: an older seat whose holder has no membership anywhere keeps today's behavior ──
    const EXEMPT = await register("Exempt");
    seat(OWNER.id, EXEMPT, labA, { since: OLD_DATE });
    check("exempt seat: no lab switcher, as today", ((await call("GET", "/api/labs/me", undefined, EXEMPT.token)).j || []).length === 0);
    const exemptList = await call("GET", "/api/competency/programs", undefined, EXEMPT.token);
    check("exempt seat: the older list route still lands on the owner's home lab, as today", exemptList.s === 200 && (exemptList.j as any[]).some((p) => p.id === inHome.program) && !(exemptList.j as any[]).some((p) => p.id === inA.program), JSON.stringify(exemptList.j).slice(0, 120));
    for (const [where, rows] of [["the owner's home lab", inHome], ["its own lab", inA], ["sister lab B", inB]] as const) {
      await expectReads("exempt seat", EXEMPT.token, rows, where, "open");
      await expectWrites("exempt seat", EXEMPT.token, rows, where, "open");
    }
    await expectReads("exempt seat", EXEMPT.token, inB, "sister lab B", "open", labB);
    const exemptNull = await register("Exemptnull");
    seat(OWNER.id, exemptNull, labA, { since: null });
    await expectReads("exempt seat with no dates", exemptNull.token, inB, "sister lab B", "open");
    await expectReads("exempt seat", EXEMPT.token, inOther, "another customer's lab", "refused");
    await expectWrites("exempt seat", EXEMPT.token, inOther, "another customer's lab", "refused");
    await expectReads("exempt seat", EXEMPT.token, inOther, "another customer's lab", "refused", other);

    // An older seat whose holder does have a membership gets the narrowed rule.
    const OLDMEMBER = await register("Oldmember");
    member(labA, OLDMEMBER.id); seat(OWNER.id, OLDMEMBER, labA, { since: OLD_DATE });
    await expectReads("older seat, holder has a membership", OLDMEMBER.token, inB, "sister lab B", "refused");
    await expectWrites("older seat, holder has a membership", OLDMEMBER.token, inB, "sister lab B", "refused");

    // ── A new seat can't fall into the exemption ──────────────────────────────
    check("the cutoff is in the past, so anything created from now on is new", String(now) >= OLDER_SEAT_BEFORE, OLDER_SEAT_BEFORE);
    // Through the real invite and sign-up, both kinds of seat.
    const seatToken = (email: string) => (sqlite.prepare("SELECT invite_token FROM user_seats WHERE seat_email = ?").get(email) as any)?.invite_token as string;
    const editorMail = `sis-invited-editor-${stamp}@example.test`, staffMail = `sis-invited-staff-${stamp}@example.test`;
    const inviteEditor = await call("POST", `/api/labs/${labA}/members`, { email: editorMail, role: "staff", firstName: "Made", lastName: "Editor" }, OWNER.token);
    const inviteStaff = await call("POST", `/api/labs/${labA}/staff-portal-invites`, { email: staffMail, firstName: "Made", lastName: "Staff", deliverEmail: false }, OWNER.token);
    check("setup: both invites went out", inviteEditor.s === 200 && inviteStaff.s === 200, `${inviteEditor.s}/${inviteStaff.s}`);
    for (const [who, mail] of [["invited editor", editorMail], ["invited Staff login", staffMail]] as const) {
      const reg = (await (await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: mail, password: "Testpass123", name: "Made Up", hipaa_acknowledged: true, inviteToken: seatToken(mail) }) })).json()) as any;
      const uid = Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(mail) as any).id);
      const s = sqlite.prepare("SELECT status, accepted_at, lab_id FROM user_seats WHERE seat_email = ?").get(mail) as any;
      const m = sqlite.prepare("SELECT status FROM lab_members WHERE user_id = ? AND lab_id = ?").get(uid, labA) as any;
      check(`${who}: accepting gives an active seat in lab A and an active membership there`, s.status === "active" && s.lab_id === labA && m?.status === "active" && String(s.accepted_at) >= OLDER_SEAT_BEFORE, JSON.stringify({ s, m }));
      check(`${who}: the owner match doesn't count for lab B`, !ownerMatchCounts(sqlite, uid, OWNER.id, labB));
      const open = await call("GET", `/api/veritacomp/assessments/${inB.assessment}`, undefined, reg.token);
      const named = await call("GET", `/api/veritacomp/assessments/${inB.assessment}`, undefined, reg.token, labB);
      check(`${who}: lab B's assessment is refused, with and without the header`, refused(open.s) && refused(named.s), `${open.s}/${named.s}`);
    }
    // Even if a seat somehow goes active today with no membership, it stays narrowed. It lands on its own lab, not the owner's home lab.
    const NEWNOMEMBER = await register("Newnomember");
    seat(OWNER.id, NEWNOMEMBER, labA);
    check("new seat with no membership anywhere: not exempt", !ownerMatchCounts(sqlite, NEWNOMEMBER.id, OWNER.id, labB) && !ownerMatchCounts(sqlite, NEWNOMEMBER.id, OWNER.id, home));
    await expectReads("new seat, no membership", NEWNOMEMBER.token, inA, "its own lab", "open");
    await expectReads("new seat, no membership", NEWNOMEMBER.token, inB, "sister lab B", "refused");
    await expectWrites("new seat, no membership", NEWNOMEMBER.token, inB, "sister lab B", "refused");
    await expectReads("new seat, no membership", NEWNOMEMBER.token, inB, "sister lab B", "refused", labB);
    await expectReads("new seat, no membership", NEWNOMEMBER.token, inHome, "the owner's home lab", "refused");
    await expectWrites("new seat, no membership", NEWNOMEMBER.token, inHome, "the owner's home lab", "refused");
    const newList = await call("GET", "/api/competency/programs", undefined, NEWNOMEMBER.token);
    check("new seat, no membership: the older list route lands on its own lab", newList.s === 200 && (newList.j as any[]).some((p) => p.id === inA.program) && !(newList.j as any[]).some((p) => p.id === inHome.program), JSON.stringify(newList.j).slice(0, 120));
    // A new seat with no lab isn't an older seat.
    const NEWNOLAB = await register("Newnolab");
    member(labA, NEWNOLAB.id); seat(OWNER.id, NEWNOLAB, null);
    await expectReads("new seat with no lab", NEWNOLAB.token, inA, "the lab it's a member of", "open");
    await expectReads("new seat with no lab", NEWNOLAB.token, inB, "sister lab B", "refused");
    await expectWrites("new seat with no lab", NEWNOLAB.token, inB, "sister lab B", "refused");
    // Holding an older seat doesn't lend age to a new one: a member with an older seat in lab A and a new seat with no lab.
    const OLDPLUSNEW = await register("Oldplusnew");
    member(labA, OLDPLUSNEW.id); seat(OWNER.id, OLDPLUSNEW, labA, { since: OLD_DATE }); seat(OWNER.id, OLDPLUSNEW, null);
    check("older seat in lab A plus a new seat with no lab: the owner match doesn't count for lab B", !ownerMatchCounts(sqlite, OLDPLUSNEW.id, OWNER.id, labB));
    // Re-accepting an older seat makes it new.
    const REACCEPT = await register("Reaccept");
    const reacceptSeat = seat(OWNER.id, REACCEPT, labA, { since: OLD_DATE });
    check("older seat before it's re-accepted: exempt", ownerMatchCounts(sqlite, REACCEPT.id, OWNER.id, labB));
    sqlite.prepare("UPDATE user_seats SET accepted_at = ? WHERE id = ?").run(now, reacceptSeat);
    check("older seat once re-accepted: not exempt", !ownerMatchCounts(sqlite, REACCEPT.id, OWNER.id, labB));
    // A deactivated seat reaches nothing.
    const DEACT = await register("Deact");
    seat(OWNER.id, DEACT, labA, { since: OLD_DATE, status: "deactivated" });
    await expectReads("deactivated older seat", DEACT.token, inB, "sister lab B", "refused");
    check("deactivated older seat: the owner match doesn't count, even asked directly", !ownerMatchCounts(sqlite, DEACT.id, OWNER.id, labB) && !ownerMatchCounts(sqlite, DEACT.id, OWNER.id, labA));
    check("the owner match counts for the owner themself, asked directly", ownerMatchCounts(sqlite, OWNER.id, OWNER.id, labB));

    // How an older seat's date was written doesn't cost it its reach. All 10 seats on production predate the cutoff.
    for (const [written, older] of [
      ["2026-03-01T12:00:00.000Z", true], ["2026-11-05T23:59:59.000Z", true], ["2026-06-09 16:20:26", true], ["Thu Jun 04 2026", true], ["no date anyone can read", true], ["", true],
      ["2026-11-06T00:00:00.000Z", false], ["2026-11-06 09:00:00", false], [now, false], ["2027-01-15T12:00:00.000Z", false],
    ] as const) check(`a seat dated "${written}": ${older ? "older" : "new"}`, isOlderSeatDate(written) === older);
    check("a seat with no date: older", isOlderSeatDate(null));

    // ── The two lab resolvers, with and without the header ────────────────────
    // Which rows come back, by id: the writes above renamed some of them.
    const ids = (j: any) => new Set<number>((Array.isArray(j) ? j : []).map((x: any) => Number(x.id)));
    const tasksAt = async (token: string, header?: number) => ids((await call("GET", "/api/veritatrack/tasks", undefined, token, header)).j);
    const programsAt = async (token: string, header?: number) => ids((await call("GET", "/api/competency/programs", undefined, token, header)).j);
    const legacyPlain = await tasksAt(EDITOR.token), legacyNamed = await tasksAt(EDITOR.token, labB);
    check("resolveLegacyLabId, editor in lab A: no header stays in lab A", legacyPlain.has(inA.task) && !legacyPlain.has(inB.task), `${Array.from(legacyPlain)}`);
    check("resolveLegacyLabId, editor in lab A: naming lab B doesn't move them", legacyNamed.has(inA.task) && !legacyNamed.has(inB.task), `${Array.from(legacyNamed)}`);
    // A Staff login can't open that list at all, so the resolver itself.
    check("resolveLegacyLabId, Staff login in lab A: no header stays in lab A", resolveLegacyLabId(sqlite, { userId: STAFF.id }) === labA);
    check("resolveLegacyLabId, Staff login in lab A: naming lab B doesn't move them", resolveLegacyLabId(sqlite, { userId: STAFF.id, headers: { "x-active-lab-id": String(labB) } }) === labA);
    const activePlain = await programsAt(EDITOR.token), activeNamed = await programsAt(EDITOR.token, labB);
    check("resolveActiveLabForRequest, editor in lab A: no header stays in lab A", activePlain.has(inA.program) && !activePlain.has(inB.program), `${Array.from(activePlain)}`);
    check("resolveActiveLabForRequest, editor in lab A: naming lab B doesn't move them", activeNamed.has(inA.program) && !activeNamed.has(inB.program), `${Array.from(activeNamed)}`);
    const mixedNamed = await programsAt(MIXED.token, labB);
    check("resolveActiveLabForRequest, a member of lab B: naming lab B works", mixedNamed.has(inB.program), `${Array.from(mixedNamed)}`);
    const mixedLegacy = await tasksAt(MIXED.token, labB);
    check("resolveLegacyLabId, a member of lab B: naming lab B works", mixedLegacy.has(inB.task), `${Array.from(mixedLegacy)}`);
    const ownerNamed = await programsAt(OWNER.token, labB), ownerLegacy = await tasksAt(OWNER.token, labB);
    check("both resolvers, the owner: naming any of their labs works", ownerNamed.has(inB.program) && ownerLegacy.has(inB.task), `${Array.from(ownerNamed)}/${Array.from(ownerLegacy)}`);
    const oldNamed = await programsAt(OLDNOLAB.token, labB), oldLegacy = await tasksAt(OLDNOLAB.token, labB);
    check("both resolvers, an older seat with no lab: naming a sister lab still works", oldNamed.has(inB.program) && oldLegacy.has(inB.task), `${Array.from(oldNamed)}/${Array.from(oldLegacy)}`);
    const exemptNamed = await programsAt(EXEMPT.token, labB), exemptLegacy = await tasksAt(EXEMPT.token, labB);
    check("both resolvers, an exempt seat: naming a sister lab still works, as today", exemptNamed.has(inB.program) && exemptLegacy.has(inB.task), `${Array.from(exemptNamed)}/${Array.from(exemptLegacy)}`);
    const newNamed = await programsAt(NEWNOMEMBER.token, labB), newLegacy = await tasksAt(NEWNOMEMBER.token, labB);
    check("both resolvers, a new seat with no membership: naming a sister lab doesn't work", !newNamed.has(inB.program) && !newLegacy.has(inB.task), `${Array.from(newNamed)}/${Array.from(newLegacy)}`);
    const foreignNamed = await programsAt(EXEMPT.token, other), foreignLegacy = await tasksAt(EXEMPT.token, other);
    check("both resolvers, an exempt seat: naming another customer's lab doesn't work", !foreignNamed.has(inOther.program) && !foreignLegacy.has(inOther.task), `${Array.from(foreignNamed)}/${Array.from(foreignLegacy)}`);

    // ── Deletes: refused across labs, and still working where they should ─────
    const del = (url: string, token: string, header?: number) => call("DELETE", url, undefined, token, header);
    const refusedDeletes: Array<[string, string, () => boolean]> = [
      ["study", `/api/studies/${inB.study}`, () => (sqlite.prepare("SELECT COUNT(*) AS n FROM studies WHERE id = ?").get(inB.study) as any).n === 1],
      ["staffing study", `/api/staffing-studies/${inB.staffing}`, () => (sqlite.prepare("SELECT COUNT(*) AS n FROM staffing_studies WHERE id = ?").get(inB.staffing) as any).n === 1],
      ["assessment", `/api/competency/assessments/${inB.assessment}`, () => (sqlite.prepare("SELECT COUNT(*) AS n FROM competency_assessments WHERE id = ?").get(inB.assessment) as any).n === 1],
      ["task", `/api/veritatrack/tasks/${inB.task}`, () => (sqlite.prepare("SELECT active FROM veritatrack_tasks WHERE id = ?").get(inB.task) as any).active === 1],
      ["cost study", `/api/veritaops/studies/${inB.cost}`, () => (sqlite.prepare("SELECT COUNT(*) AS n FROM veritaops_test_cost_studies WHERE id = ?").get(inB.cost) as any).n === 1],
    ];
    for (const [name, url, stillThere] of refusedDeletes) {
      const r = await del(url, EDITOR.token);
      check(`editor in lab A: deleting lab B's ${name} is refused and it stays`, refused(r.s) && stillThere(), `${r.s}`);
    }
    const prodB = seed("productivity_months", { account_id: OWNER.id, lab_id: labB, year: 2026, month: 1 });
    const prodDel = await del(`/api/productivity/${prodB}`, EDITOR.token);
    check("editor in lab A: deleting lab B's productivity month is refused", refused(prodDel.s) && (sqlite.prepare("SELECT COUNT(*) AS n FROM productivity_months WHERE id = ?").get(prodB) as any).n === 1, `${prodDel.s}`);
    const prodA = seed("productivity_months", { account_id: OWNER.id, lab_id: labA, year: 2026, month: 2 });
    check("editor in lab A: deleting lab A's productivity month works", (await del(`/api/productivity/${prodA}`, EDITOR.token)).s === 200);
    const studyA = seed("studies", { user_id: OWNER.id, lab_id: labA, test_name: "Delete me", instrument: "x", analyst: "x", date: "2026-10-15", study_type: "precision", clia_allowable_error: 0.1, data_points: "[]", instruments: "[]", status: "completed", created_at: now });
    check("editor in lab A: deleting lab A's study works", (await del(`/api/studies/${studyA}`, EDITOR.token)).s === 200);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
