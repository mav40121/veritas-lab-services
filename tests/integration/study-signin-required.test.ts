// tests/integration/study-signin-required.test.ts
//
// Michael 2026-11-06, Q193 = 1. Signing in is required to save or open a study. These routes used to answer anyone: a guest could save a
// study with no owner, open any study with no owner, and list them all. The rows already there stay in place and unopened, even signed in,
// until Michael decides whether they stay. Boots the REAL routes on a scratch DB with made-up people.
// Run: npm run test:study-signin-required
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
  const call = async (method: string, path: string, body: unknown, auth?: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth) headers.Authorization = auth;
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const register = async (tag: string) => {
    const email = `signin-${tag}-${stamp}@example.test`;
    const reg = (await call("POST", "/api/auth/register", { email, password: "Testpass123", name: `Made Up ${tag}`, hipaa_acknowledged: true })).j;
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any).id) };
  };
  const studyRow = (userId: number | null, labId: number | null, testName: string) => Number(sqlite.prepare(
    `INSERT INTO studies (user_id, lab_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
     VALUES (?, ?, ?, 'Made-up Analyzer', 'Made Up Analyst', '2026-10-15', 'precision', 0.1, '[]', '[]', 'completed', ?)`
  ).run(userId, labId, testName, now).lastInsertRowid);
  const studyCount = () => Number((sqlite.prepare("SELECT COUNT(*) AS n FROM studies").get() as any).n);
  const DRAFT = { status: "draft", testName: "SAVED draft", studyType: "precision" };

  try {
    const OWNER = await register("owner"), OTHER = await register("other"), EDITOR = await register("editor");
    const labId = Number((await call("POST", "/api/admin/provision-demo-lab", { secret: ADMIN, ownerEmail: OWNER.email, labName: "Made-up Sign-in Lab", plan: "hospital" })).j.labId);
    const now2 = new Date().toISOString();
    sqlite.prepare(`INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', '{}', 'active', 1, ?, ?, ?)`).run(labId, EDITOR.id, now2, now2, now2);
    sqlite.prepare(`INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{"mode":"edit_all","veritacheck":"edit"}', ?, ?, 'active')`).run(OWNER.id, EDITOR.email, EDITOR.id, now2, now2, `signin-${stamp}`, labId); // this older route reads only the flat form

    const owned = studyRow(OWNER.id, labId, "OWNED study");
    const noOwner = studyRow(null, null, "ORPHAN no owner");
    const zeroOwner = studyRow(0, null, "ORPHAN owner zero");
    const noOwnerInLab = studyRow(null, labId, "ORPHAN with a lab");
    const orphans = [["no owner", noOwner], ["owner zero", zeroOwner], ["no owner, with a lab", noOwnerInLab]] as const;
    const MISSING = 99999999;
    const shows = (r: { text: string }) => /ORPHAN|OWNED/.test(r.text);
    const before = studyCount();

    // ── Signed out, and with a bad session: the same answers ──────────────────
    for (const [who, auth] of [["signed out", undefined], ["a token that isn't one", "Bearer not-a-real-token"], ["the wrong kind of header", "Basic abc"]] as const) {
      const list = await call("GET", "/api/studies", undefined, auth);
      check(`1a. ${who}: the list is refused and shows nothing`, list.s === 401 && !shows(list), `${list.s} ${list.text.slice(0, 80)}`);
      const answers = await Promise.all([owned, noOwner, zeroOwner, noOwnerInLab, MISSING].map((id) => call("GET", `/api/studies/${id}`, undefined, auth)));
      check(`1b. ${who}: opening a study is refused, with the same answer whether it exists or not`, answers.every((r) => r.s === 403 && !shows(r)) && new Set(answers.map((r) => r.text)).size === 1, answers.map((r) => r.s).join());
      const draft = await call("POST", "/api/studies", DRAFT, auth);
      check(`1c. ${who}: saving a draft is refused`, draft.s === 401, `${draft.s}`);
      const bad = await call("POST", "/api/studies", { nonsense: true }, auth);
      check(`1d. ${who}: refused before the body is even read`, bad.s === 401, `${bad.s}`);
    }
    check("2. nothing was saved by any of that", studyCount() === before, `${before} -> ${studyCount()}`);

    // ── Signed in: everything that worked keeps working ───────────────────────
    const list = await call("GET", "/api/studies", undefined, `Bearer ${OWNER.token}`);
    check("3a. the owner lists their studies, and none with no owner and no lab", list.s === 200 && list.j.some?.((s: any) => s.id === owned) && !list.j.some?.((s: any) => s.id === noOwner || s.id === zeroOwner), list.text.slice(0, 160));
    // A row with no owner that does carry a lab is that lab's record: its members still see it through the lab. access-audit-counts reports how many there are.
    const labList = await call("GET", `/api/labs/${labId}/studies`, undefined, `Bearer ${OWNER.token}`);
    check("3a2. a study with no owner but a lab stays with that lab's members, and nobody else", labList.s === 200 && labList.j.some?.((s: any) => s.id === noOwnerInLab) && (await call("GET", `/api/labs/${labId}/studies/${noOwnerInLab}`, undefined, `Bearer ${OTHER.token}`)).s === 403, `${labList.s}`);
    const open = await call("GET", `/api/studies/${owned}`, undefined, `Bearer ${OWNER.token}`);
    check("3b. the owner opens their study", open.s === 200 && open.j.testName === "OWNED study", `${open.s}`);
    const seatOpen = await call("GET", `/api/studies/${owned}`, undefined, `Bearer ${EDITOR.token}`);
    check("3c. an editor seat in the lab opens it", seatOpen.s === 200, `${seatOpen.s}`);
    const outsider = await call("GET", `/api/studies/${owned}`, undefined, `Bearer ${OTHER.token}`);
    check("3d. someone else signed in is still refused", outsider.s === 403 && !shows(outsider), `${outsider.s}`);
    const missing = await call("GET", `/api/studies/${MISSING}`, undefined, `Bearer ${OWNER.token}`);
    check("3e. signed in, a study that doesn't exist is 404", missing.s === 404, `${missing.s}`);
    const saved = await call("POST", "/api/studies", DRAFT, `Bearer ${OWNER.token}`);
    const savedRow = sqlite.prepare("SELECT user_id, created_by_user_id, lab_id FROM studies WHERE id = ?").get(saved.j.id) as any;
    check("3f. the owner saves a study, filed under them and their lab", saved.s === 201 && savedRow?.user_id === OWNER.id && savedRow?.created_by_user_id === OWNER.id && savedRow?.lab_id === labId, `${saved.s} ${JSON.stringify(savedRow)}`);
    const seatSaved = await call("POST", "/api/studies", { ...DRAFT, testName: "SAVED by seat" }, `Bearer ${EDITOR.token}`);
    const seatRow = sqlite.prepare("SELECT user_id, created_by_user_id FROM studies WHERE id = ?").get(seatSaved.j.id) as any;
    check("3g. an editor seat saves one, filed under the owner and credited to them", seatSaved.s === 201 && seatRow?.user_id === OWNER.id && seatRow?.created_by_user_id === EDITOR.id, `${seatSaved.s} ${JSON.stringify(seatRow)}`);
    const incomplete = await call("POST", "/api/studies", { status: "draft" }, `Bearer ${OWNER.token}`);
    check("3h. signed in, a study missing its fields still gets the 400", incomplete.s === 400, `${incomplete.s}`);
    const count = before + 2;
    check("3i. saving added those two rows and nothing else", studyCount() === count, `${studyCount()} vs ${count}`);
    const noOwnerAfter = Number((sqlite.prepare("SELECT COUNT(*) AS n FROM studies WHERE user_id IS NULL OR user_id = 0").get() as any).n);
    check("3j. no save, signed in or out, made a study with no owner", noOwnerAfter === 3, `${noOwnerAfter}`);

    // ── The rows with no owner stay in place and unopened ─────────────────────
    for (const [label, id] of orphans) {
      for (const [who, token] of [["the owner", OWNER.token], ["an editor seat", EDITOR.token], ["someone else", OTHER.token]] as const) {
        const r = await call("GET", `/api/studies/${id}`, undefined, `Bearer ${token}`);
        check(`4a. a study with ${label}: ${who} gets 404, with nothing in it`, r.s === 404 && !shows(r), `${r.s}`);
      }
    }
    const rowsLeft = sqlite.prepare("SELECT id, test_name FROM studies WHERE id IN (?, ?, ?) ORDER BY id").all(noOwner, zeroOwner, noOwnerInLab) as any[];
    check("4b. all three are still there, untouched", rowsLeft.length === 3 && rowsLeft.every((r) => /^ORPHAN/.test(r.test_name)), JSON.stringify(rowsLeft));
    const counts = await call("GET", "/api/admin/access-audit-counts", undefined);
    check("4c. the admin count route still refuses with no secret", counts.s === 403, `${counts.s}`);
    const audit = await (await fetch(`${base}/api/admin/access-audit-counts`, { headers: { "x-admin-secret": ADMIN } })).json() as any;
    check("4d. and with it, counts them, with their dates and how many carry a lab", audit.studiesWithNoOwner === 3 && audit.studiesWithNoOwnerDates.oldest === now.slice(0, 10) && audit.studiesWithNoOwnerDates.newest === now.slice(0, 10) && audit.studiesWithNoOwnerDates.withALab === 1, JSON.stringify(audit.studiesWithNoOwnerDates));

    // ── The demo keeps working with no sign-in: it has its own routes ─────────
    const demo = await call("GET", "/api/demo/studies", undefined);
    check("5. the public demo's own study route doesn't need a sign-in", demo.s === 200 || demo.s === 404, `${demo.s}`);
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
