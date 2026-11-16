// tests/integration/rollup-groups.test.ts
//
// Roll-up groups, Phase 1 (Michael 2026-11-16: "Could her consultants get a roll up of their labs with a bigger system roll
// up for angie? ... Lets build it regardless"; server/rollupGroups.ts). Made-up people, labs and an organization on a fresh
// database, through the real routes. It checks:
//   1. the plan allowlist: a free account gets 403 PLAN_REQUIRED
//   2. a person's own network: groups hold only labs they belong to (LAB_NOT_ELIGIBLE otherwise, nothing written); a lab
//      can sit in two groups; the list carries group names and lab ids, no names or addresses
//   3. privacy and edits: someone else neither sees another person's groups nor edits them (the same 404 as a missing id)
//   4. a system's groups: only its org_owner or org_admin adds or sees them (ORG_ADMIN_ONLY for a lab member), and they
//      hold only that system's labs, never a repository lab
//   5. names: required, 80 characters at most, refused when they look like patient information (PHI_REFUSED); kind is
//      region, consultant or other
//   6. an edit never drops a lab the editor no longer sees, and the reader's list is cut to the labs they see
//   7. nothing about access changes: the roll-up each person gets is the same before and after groups exist, and a group
//      holding a lab never puts it in anyone else's roll-up
//   8. every change writes one audit_log row; delete removes the grouping and leaves the labs alone
//   9. the admin routes: header only (a body secret is refused), create is a dry run unless dryRun is false, eligibility
//      is the same as for a person, list and delete work
// Run: rm -f .tmp-rollupgroups.db && DB_PATH=.tmp-rollupgroups.db JWT_SECRET=test-jwt-secret ADMIN_SECRET=test-admin-secret STRIPE_SECRET_KEY=sk_test_dummy STRIPE_WEBHOOK_SECRET=whsec_dummy npx tsx tests/integration/rollup-groups.test.ts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  :: ${detail}`}`);
};

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const { detectPhi } = await import("../../shared/phiPatterns");
  const sqlite = (db as any).$client;
  sqlite.pragma("foreign_keys = OFF");
  const cols = (t: string) => sqlite.prepare(`PRAGMA table_info(${t})`).all() as { name: string; notnull: number; dflt_value: any }[];
  const insert = (table: string, values: Record<string, unknown>) => {
    const row: Record<string, unknown> = { ...values };
    for (const c of cols(table)) if (c.notnull && c.dflt_value == null && !(c.name in row) && c.name !== "id") row[c.name] = /_at$|date/i.test(c.name) ? "2026-11-10T00:00:00Z" : /count|_id$|is_/i.test(c.name) ? 0 : "made-up";
    const keys = Object.keys(row);
    return Number(sqlite.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map((k) => "@" + k).join(",")})`).run(row).lastInsertRowid);
  };
  const user = (tag: string, plan = "hospital") => insert("users", { email: `${tag}-rg@example.test`, name: `Made-up ${tag}`, plan, seat_count: 0 });
  const labOf = (name: string, owner: number, extra: Record<string, unknown> = {}) => insert("labs", { lab_name: name, owner_user_id: owner, plan: "hospital", ...extra });
  const member = (lab: number, u: number, role = "admin") => insert("lab_members", { lab_id: lab, user_id: u, role, status: "active" });

  // ── People and labs ──
  const LEAD = user("lead"), C1 = user("consultant1"), C2 = user("consultant2"), OUT = user("outsider"), FREE = user("free", "free");
  const S1 = labOf("Made-up Client 1", user("o1")), S2 = labOf("Made-up Client 2", user("o2")), S3 = labOf("Made-up Client 3", user("o3"));
  for (const l of [S1, S2, S3]) member(l, LEAD);
  member(S1, C1); member(S2, C1); member(S2, C2); member(S3, C2);
  const OL = labOf("Made-up Outsider Lab", OUT); member(OL, OUT, "owner");
  const F1 = labOf("Made-up Free 1", FREE), F2 = labOf("Made-up Free 2", FREE); member(F1, FREE, "owner"); member(F2, FREE, "owner");
  const XOWN = user("xowner"), ORGADMIN = user("orgadmin"), XMEMBER = user("xmember");
  const ORG = insert("organizations", { name: "Made-up System X", billing_owner_user_id: XOWN });
  insert("organization_members", { organization_id: ORG, user_id: ORGADMIN, org_role: "org_admin", status: "active" });
  const X1 = labOf("Made-up System Lab 1", XOWN, { organization_id: ORG }), X2 = labOf("Made-up System Lab 2", XOWN, { organization_id: ORG });
  const XR = labOf("Made-up System Repository", XOWN, { organization_id: ORG, is_repository: 1 });
  member(X1, XMEMBER, "staff");

  const app = express();
  app.use(express.json());
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const ADMIN = process.env.ADMIN_SECRET || "";
  const jwt = (await import("jsonwebtoken")).default;
  const tok = (uid: number) => jwt.sign({ svc: true, userId: uid }, process.env.JWT_SECRET!, { expiresIn: "10m" });
  const call = async (method: string, path: string, uid: number | null, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(uid ? { Authorization: `Bearer ${tok(uid)}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const rollupIds = async (uid: number) => ((await call("GET", "/api/readiness/rollup", uid)).j as any[]).map((l) => l.lab_id).sort((a, b) => a - b);
  const groupCount = () => (sqlite.prepare("SELECT COUNT(*) AS n FROM rollup_groups").get() as any).n as number;
  try {
    const before = { lead: await rollupIds(LEAD), c1: await rollupIds(C1), c2: await rollupIds(C2), admin: await rollupIds(ORGADMIN) };

    // 1. plan allowlist
    const free = await call("GET", "/api/rollup-groups", FREE);
    check("1. a free account gets 403 PLAN_REQUIRED", free.s === 403 && free.j.code === "PLAN_REQUIRED", `${free.s} ${free.text.slice(0, 120)}`);

    // 2. own network
    const g0 = await call("GET", "/api/rollup-groups", LEAD);
    check("2. the lead starts with no groups and can build from the 3 labs they belong to",
      g0.s === 200 && g0.j.groups.length === 0 && JSON.stringify(g0.j.can_build.personal.lab_ids) === JSON.stringify([S1, S2, S3].sort((a, b) => a - b)) && g0.j.can_build.organizations.length === 0, JSON.stringify(g0.j));
    const a = await call("POST", "/api/rollup-groups", LEAD, { name: "Consultant 1", kind: "consultant", labIds: [S1, S2] });
    const b = await call("POST", "/api/rollup-groups", LEAD, { name: "Consultant 2", kind: "consultant", labIds: [S2, S3] });
    check("2. two consultant groups created (201), S2 in both", a.s === 201 && b.s === 201 && a.j.id && b.j.id, `${a.s} ${b.s}`);
    const n0 = groupCount();
    const bad = await call("POST", "/api/rollup-groups", LEAD, { name: "Has a stranger's lab", labIds: [S1, OL] });
    check("2. a lab the lead doesn't belong to is refused (LAB_NOT_ELIGIBLE, names the lab), nothing written",
      bad.s === 400 && bad.j.code === "LAB_NOT_ELIGIBLE" && JSON.stringify(bad.j.labIds) === JSON.stringify([OL]) && groupCount() === n0, `${bad.s} ${bad.text.slice(0, 160)}`);
    const g1 = await call("GET", "/api/rollup-groups", LEAD);
    const gA = g1.j.groups.find((g: any) => g.id === a.j.id), gB = g1.j.groups.find((g: any) => g.id === b.j.id);
    check("2. the list holds both, by name, personal scope, with their lab ids", g1.j.groups.length === 2 && g1.j.groups[0].name === "Consultant 1"
      && gA.scope === "personal" && JSON.stringify(gA.lab_ids) === JSON.stringify([S1, S2].sort((x, y) => x - y)) && JSON.stringify(gB.lab_ids) === JSON.stringify([S2, S3].sort((x, y) => x - y)), JSON.stringify(g1.j.groups));
    check("2. no person's name or address in the answer", !/@|Made-up/.test(JSON.stringify(g1.j)), JSON.stringify(g1.j).slice(0, 200));

    // 3. privacy and edits
    const c1List = await call("GET", "/api/rollup-groups", C1);
    check("3. a consultant doesn't see the lead's groups", c1List.s === 200 && c1List.j.groups.length === 0, JSON.stringify(c1List.j.groups));
    const p = await call("PATCH", `/api/rollup-groups/${a.j.id}`, C1, { name: "Hijacked" });
    const u = await call("PUT", `/api/rollup-groups/${a.j.id}/labs`, C1, { labIds: [S1] });
    const d = await call("DELETE", `/api/rollup-groups/${a.j.id}`, C1);
    const missing = await call("PATCH", "/api/rollup-groups/999999", C1, { name: "x" });
    check("3. someone else can't rename, re-label or delete it: the same 404 as a missing group",
      p.s === 404 && u.s === 404 && d.s === 404 && missing.s === 404 && p.j.code === missing.j.code, `${p.s} ${u.s} ${d.s} ${missing.s}`);
    check("3. ... and it is unchanged", (sqlite.prepare("SELECT name FROM rollup_groups WHERE id = ?").get(a.j.id) as any).name === "Consultant 1");

    // 4. a system's groups
    const adminView = await call("GET", "/api/rollup-groups", ORGADMIN);
    const orgBuild = adminView.j.can_build?.organizations?.find((o: any) => o.id === ORG);
    check("4. the org admin can build for the system from its two labs (the repository lab left out)",
      adminView.s === 200 && orgBuild && JSON.stringify(orgBuild.lab_ids) === JSON.stringify([X1, X2].sort((x, y) => x - y)), JSON.stringify(adminView.j.can_build));
    const og = await call("POST", "/api/rollup-groups", ORGADMIN, { name: "North region", kind: "region", organizationId: ORG, labIds: [X1] });
    check("4. the org admin adds a region group with a system lab (201)", og.s === 201, `${og.s} ${og.text.slice(0, 120)}`);
    const ogOut = await call("POST", "/api/rollup-groups", ORGADMIN, { name: "Mixed", organizationId: ORG, labIds: [X1, S1] });
    const ogRepo = await call("POST", "/api/rollup-groups", ORGADMIN, { name: "Repo", organizationId: ORG, labIds: [XR] });
    check("4. a lab outside the system, or the repository lab, is refused (LAB_NOT_ELIGIBLE)", ogOut.s === 400 && ogOut.j.code === "LAB_NOT_ELIGIBLE" && ogRepo.s === 400, `${ogOut.s} ${ogRepo.s}`);
    const memberAdd = await call("POST", "/api/rollup-groups", XMEMBER, { name: "Mine", organizationId: ORG, labIds: [X1] });
    const memberList = await call("GET", "/api/rollup-groups", XMEMBER);
    check("4. a system lab's member who isn't an org admin can't add its groups (403 ORG_ADMIN_ONLY) or see them",
      memberAdd.s === 403 && memberAdd.j.code === "ORG_ADMIN_ONLY" && memberList.j.groups.length === 0, `${memberAdd.s} ${JSON.stringify(memberList.j.groups)}`);
    const adminList = await call("GET", "/api/rollup-groups", ORGADMIN);
    const north = adminList.j.groups.find((g: any) => g.id === og.j.id);
    check("4. the org admin sees it as the system's, named for the system", north?.scope === "organization" && north?.organization_id === ORG && north?.organization_name === "Made-up System X");

    // 5. names and kinds
    const phiName = "MRN 00123456";
    check("5. (the test string is one detectPhi flags)", detectPhi(phiName).length > 0);
    const r1 = await call("POST", "/api/rollup-groups", LEAD, { name: "   ", labIds: [S1] });
    const r2 = await call("POST", "/api/rollup-groups", LEAD, { name: "x".repeat(81), labIds: [S1] });
    const r3 = await call("POST", "/api/rollup-groups", LEAD, { name: phiName, labIds: [S1] });
    const r4 = await call("POST", "/api/rollup-groups", LEAD, { name: "Fine", kind: "bogus", labIds: [S1] });
    check("5. blank name 400 NAME_REQUIRED, 81 characters 400 NAME_TOO_LONG, patient-looking 400 PHI_REFUSED, unknown kind 400 KIND_INVALID",
      r1.j.code === "NAME_REQUIRED" && r2.j.code === "NAME_TOO_LONG" && r3.s === 400 && r3.j.code === "PHI_REFUSED" && r4.j.code === "KIND_INVALID", [r1.j.code, r2.j.code, r3.j.code, r4.j.code].join(","));
    const ren = await call("PATCH", `/api/rollup-groups/${a.j.id}`, LEAD, { name: "  Consultant  One ", kind: "consultant" });
    check("5. rename trims and folds spaces", ren.s === 200 && (sqlite.prepare("SELECT name FROM rollup_groups WHERE id = ?").get(a.j.id) as any).name === "Consultant One");

    // 6. an edit never drops what the editor can't see
    sqlite.prepare("UPDATE lab_members SET status = 'deactivated' WHERE lab_id = ? AND user_id = ?").run(S3, LEAD);
    const cut = await call("GET", "/api/rollup-groups", LEAD);
    check("6. once the lead leaves lab 3, Consultant 2 reads only lab 2 to them", JSON.stringify(cut.j.groups.find((g: any) => g.id === b.j.id).lab_ids) === JSON.stringify([S2]));
    const put = await call("PUT", `/api/rollup-groups/${b.j.id}/labs`, LEAD, { labIds: [S2] });
    const stored = (sqlite.prepare("SELECT lab_id FROM rollup_group_labs WHERE group_id = ? ORDER BY lab_id").all(b.j.id) as any[]).map((r) => r.lab_id);
    check("6. saving lab 2 keeps lab 3 in the group (the editor no longer sees it)", put.s === 200 && JSON.stringify(stored) === JSON.stringify([S2, S3].sort((x, y) => x - y)), JSON.stringify(stored));
    const putS3 = await call("PUT", `/api/rollup-groups/${b.j.id}/labs`, LEAD, { labIds: [S2, S3] });
    check("6. ... and they can't add a lab they don't belong to (lab 3 now)", putS3.s === 400 && putS3.j.code === "LAB_NOT_ELIGIBLE");
    sqlite.prepare("UPDATE lab_members SET status = 'active' WHERE lab_id = ? AND user_id = ?").run(S3, LEAD);

    // 7. access doesn't change
    const after = { lead: await rollupIds(LEAD), c1: await rollupIds(C1), c2: await rollupIds(C2), admin: await rollupIds(ORGADMIN) };
    check("7. every person's roll-up is the same lab list before and after the groups", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    check("7. consultant 1's roll-up still has only labs 1 and 2 though a group of the lead's holds lab 3",
      JSON.stringify(after.c1) === JSON.stringify([S1, S2].sort((x, y) => x - y)));
    const c1lab3 = await call("GET", `/api/labs/${S3}/readiness`, C1, undefined, { "X-Active-Lab-Id": String(S3) });
    check("7. consultant 1 still can't open lab 3's readiness", c1lab3.s === 403 || c1lab3.s === 404, String(c1lab3.s));

    // 8. audit and delete
    const auditN = (id: number) => (sqlite.prepare("SELECT action FROM audit_log WHERE entity_type = 'rollup_group' AND entity_id = ? ORDER BY id").all(String(id)) as any[]).map((r) => r.action);
    check("8. audit rows: create, update, for Consultant One", JSON.stringify(auditN(a.j.id)) === JSON.stringify(["create", "update"]), JSON.stringify(auditN(a.j.id)));
    check("8. audit rows: create, set_labs, for Consultant 2", JSON.stringify(auditN(b.j.id)) === JSON.stringify(["create", "set_labs"]), JSON.stringify(auditN(b.j.id)));
    const labsBefore = (sqlite.prepare("SELECT COUNT(*) AS n FROM labs").get() as any).n;
    const del = await call("DELETE", `/api/rollup-groups/${a.j.id}`, LEAD);
    check("8. delete removes the group and its lab rows, logs it, and leaves every lab",
      del.s === 200 && !sqlite.prepare("SELECT 1 FROM rollup_groups WHERE id = ?").get(a.j.id) && !sqlite.prepare("SELECT 1 FROM rollup_group_labs WHERE group_id = ?").get(a.j.id)
        && auditN(a.j.id).at(-1) === "delete" && (sqlite.prepare("SELECT COUNT(*) AS n FROM labs").get() as any).n === labsBefore);

    // 9. admin routes
    const noHdr = await call("GET", `/api/admin/rollup-groups?ownerUserId=${LEAD}`, null);
    const bodySecret = await call("POST", "/api/admin/rollup-groups", null, { secret: ADMIN, ownerUserId: LEAD, name: "x", labIds: [S1] });
    check("9. admin routes refuse without the header, even with the secret in the body", noHdr.s === 403 && bodySecret.s === 403, `${noHdr.s} ${bodySecret.s}`);
    const H = { "x-admin-secret": ADMIN };
    const n1 = groupCount();
    const dry = await call("POST", "/api/admin/rollup-groups", null, { ownerUserId: LEAD, name: "Admin made", kind: "consultant", labIds: [S1, S3] }, H);
    check("9. admin create is a dry run by default: the plan, nothing written", dry.s === 200 && dry.j.dryRun === true && groupCount() === n1, JSON.stringify(dry.j));
    const ineligibleAdmin = await call("POST", "/api/admin/rollup-groups", null, { ownerUserId: LEAD, name: "Bad", labIds: [OL], dryRun: false }, H);
    const bothScopes = await call("POST", "/api/admin/rollup-groups", null, { ownerUserId: LEAD, organizationId: ORG, name: "Bad", labIds: [] }, H);
    check("9. admin eligibility is the person's (LAB_NOT_ELIGIBLE), and exactly one scope (SCOPE_REQUIRED)", ineligibleAdmin.j.code === "LAB_NOT_ELIGIBLE" && bothScopes.j.code === "SCOPE_REQUIRED");
    const real = await call("POST", "/api/admin/rollup-groups", null, { ownerUserId: LEAD, name: "Admin made", kind: "consultant", labIds: [S1, S3], dryRun: false }, H);
    const listed = await call("GET", `/api/admin/rollup-groups?ownerUserId=${LEAD}`, null, undefined, H);
    check("9. admin create writes it, the lead sees it, the admin list shows it",
      real.s === 200 && real.j.id && listed.j.groups.some((g: any) => g.id === real.j.id) && (await call("GET", "/api/rollup-groups", LEAD)).j.groups.some((g: any) => g.id === real.j.id));
    const orgListed = await call("GET", `/api/admin/rollup-groups?organizationId=${ORG}`, null, undefined, H);
    check("9. admin list by organization shows the system's group", orgListed.j.groups.length === 1 && orgListed.j.groups[0].name === "North region");
    const adel = await call("DELETE", `/api/admin/rollup-groups/${real.j.id}`, null, undefined, H);
    check("9. admin delete removes it", adel.s === 200 && !sqlite.prepare("SELECT 1 FROM rollup_groups WHERE id = ?").get(real.j.id));
  } finally {
    server.close();
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
