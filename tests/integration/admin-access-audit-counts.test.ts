// tests/integration/admin-access-audit-counts.test.ts
//
// GET /api/admin/access-audit-counts: read-only numbers for the access work, so a fix can be sized before it changes who can open what.
// Boots the REAL routes on a scratch DB with made-up rows. Each row below is there to be counted or to be left out, and the numbers
// must come out exact. It must refuse without the secret, take it only from the header, return nothing but numbers, and write nothing.
// Run: npm run test:admin-access-audit-counts
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";

(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
const check = (name: string, cond: boolean, detail = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`); if (!cond) failures++; };

const URL_PATH = "/api/admin/access-audit-counts";

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
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { headers });
    const text = await r.text();
    let j: any = {}; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { s: r.status, j, text };
  };
  const asAdmin = () => get(URL_PATH, { "x-admin-secret": ADMIN });

  try {
    const before = await asAdmin();
    check("1. the route answers with the secret in the header", before.s === 200, `${before.s}`);
    const startSeats = before.j.activeSeatsWithNoActiveMembership;

    // ── Made-up rows ──────────────────────────────────────────────────────────
    const user = (tag: string) => Number(sqlite.prepare(
      "INSERT INTO users (email, password_hash, name, created_at) VALUES (?, 'x', ?, ?)"
    ).run(`zaudit-${tag}-${stamp}@example.test`, `Zaudit Person ${tag}`, now).lastInsertRowid);
    const owner = user("owner");
    const lab = (name: string) => Number(sqlite.prepare("INSERT INTO labs (lab_name, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?)").run(name, owner, now, now).lastInsertRowid);
    const labA = lab("Zaudit Lab A"), labB = lab("Zaudit Lab B");
    const member = (labId: number, userId: number, status = "active") => sqlite.prepare(
      "INSERT INTO lab_members (lab_id, user_id, role, permissions_json, status, is_primary_lab, created_at, updated_at) VALUES (?, ?, 'staff', '{}', ?, 0, ?, ?)"
    ).run(labId, userId, status, now, now);
    const seat = (tag: string, userId: number | null, labId: number | null, seatType: string, status = "active") => sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, status, permissions, invite_token, lab_id, seat_type)
       VALUES (?, ?, ?, ?, ?, '{"mode":"view_all"}', ?, ?, ?)`
    ).run(owner, `zaudit-seat-${tag}-${stamp}@example.test`, userId, now, status, `zaudit-${tag}-${stamp}`, labId, seatType);
    const study = (userId: number | null, tag: string) => sqlite.prepare(
      `INSERT INTO studies (user_id, test_name, instrument, analyst, date, study_type, clia_allowable_error, data_points, instruments, status, created_at)
       VALUES (?, ?, 'Zaudit Analyzer', ?, '2026-10-15', 'method_comparison', 0.1, '[]', '[]', 'completed', ?)`
    ).run(userId, `Zaudit test ${tag}`, `Zaudit Analyst ${tag}`, now);

    // Studies: no owner is what GET /api/studies/:id treats as open, so NULL and 0 both count. One with an owner doesn't.
    study(null, "null-owner-1");
    study(null, "null-owner-2");
    study(0, "zero-owner");
    study(owner, "has-owner");

    // Not counted: a live seat with a live membership in the same lab.
    const fine = user("fine"); member(labA, fine); seat("fine", fine, labA, "staff_portal");
    // Counted: the sister-lab case, a live seat in lab B whose only membership is in lab A.
    const sister = user("sister"); member(labA, sister); seat("sister", sister, labB, "staff_portal");
    // Counted: a live seat with no membership anywhere.
    const noMember = user("nomember"); seat("nomember", noMember, labA, "active");
    // Counted: a live seat whose membership in that lab isn't active.
    const lapsed = user("lapsed"); member(labA, lapsed, "removed"); seat("lapsed", lapsed, labA, "view_only");
    // Counted, and also shown apart: an older seat with no lab on it can never match a membership.
    const noLab = user("nolab"); member(labA, noLab); seat("nolab", noLab, null, "staff_portal");
    // Counted, and also shown apart: a seat nobody has claimed, so no login stands behind it.
    seat("nouser", null, labA, "active");
    // Not counted: seats that aren't active, with no membership behind them.
    const pending = user("pending"); seat("pending", pending, labA, "staff_portal", "pending");
    const off = user("off"); seat("off", off, labA, "active", "deactivated");

    // Older seats still under the older rule (Michael Q191 = 1): one with no lab, one whose holder has no membership anywhere. The rest don't count.
    const OLD = "2026-03-01T12:00:00.000Z";
    const oldSeat = (tag: string, userId: number, labId: number | null) => sqlite.prepare(
      `INSERT INTO user_seats (owner_user_id, seat_email, seat_user_id, invited_at, accepted_at, status, permissions, invite_token, lab_id, seat_type) VALUES (?, ?, ?, ?, ?, 'active', '{}', ?, ?, 'active')`
    ).run(owner, `zaudit-seat-${tag}-${stamp}@example.test`, userId, OLD, OLD, `zaudit-${tag}-${stamp}`, labId);
    const oldNoLab = user("oldnolab"); member(labA, oldNoLab); oldSeat("oldnolab", oldNoLab, null);
    const oldBare = user("oldbare"); oldSeat("oldbare", oldBare, labA);
    const oldMember = user("oldmember"); member(labA, oldMember); oldSeat("oldmember", oldMember, labA);

    // ── Exact counts ──────────────────────────────────────────────────────────
    const after = await asAdmin();
    const seats = after.j.activeSeatsWithNoActiveMembership;
    const added = (type: string) => (seats.bySeatType[type] || 0) - (startSeats.bySeatType[type] || 0);
    check("2. studies with no owner: NULL and 0 both count, one with an owner doesn't", after.j.studiesWithNoOwner - before.j.studiesWithNoOwner === 3, `${before.j.studiesWithNoOwner} -> ${after.j.studiesWithNoOwner}`);
    check("3. active seats with no active membership: the total is exact", seats.total - startSeats.total === 7, `${startSeats.total} -> ${seats.total}`);
    check("4. per seat type: exact", added("staff_portal") === 2 && added("active") === 4 && added("view_only") === 1, JSON.stringify(seats.bySeatType));
    check("5. the per-type numbers add up to the total", Object.values(seats.bySeatType as Record<string, number>).reduce((a, b) => a + b, 0) === seats.total);
    check("6. seats with no lab on them are shown apart", seats.withNoLabOnSeat - startSeats.withNoLabOnSeat === 2, `${seats.withNoLabOnSeat}`);
    check("7. seats nobody has claimed are shown apart", seats.withNoUserOnSeat - startSeats.withNoUserOnSeat === 1, `${seats.withNoUserOnSeat}`);

    const olderNow = after.j.olderSeatsKeepingOwnerReach, olderBefore = before.j.olderSeatsKeepingOwnerReach;
    check("7b. older seats under the older rule: exact, and a new seat with no lab or no membership isn't one", olderNow.withNoLab - olderBefore.withNoLab === 1 && olderNow.holderHasNoMembership - olderBefore.holderHasNoMembership === 1, JSON.stringify(olderNow));

    // ── Numbers only ──────────────────────────────────────────────────────────
    check("8. no email, name, lab name, analyst or test name in the answer", !/zaudit|example\.test|@/i.test(after.text), after.text.slice(0, 300));
    const leaves = (v: unknown): unknown[] => (v && typeof v === "object" ? Object.values(v as object).flatMap(leaves) : [v]);
    check("9. every value is a number", leaves(after.j).length > 0 && leaves(after.j).every((v) => typeof v === "number"), after.text.slice(0, 300));
    check("10. the only keys are the counts and the seat types", Object.keys(after.j).sort().join() === "activeSeatsWithNoActiveMembership,olderSeatsKeepingOwnerReach,studiesWithNoOwner" && Object.keys(seats).sort().join() === "bySeatType,total,withNoLabOnSeat,withNoUserOnSeat" && Object.keys(seats.bySeatType).every((k) => ["active", "staff_portal", "view_only"].includes(k)), after.text.slice(0, 300));

    // ── Read-only ─────────────────────────────────────────────────────────────
    const changes = () => Number((sqlite.prepare("SELECT total_changes() AS n").get() as any).n);
    const changesBefore = changes();
    const again = await asAdmin();
    check("11. calling it writes nothing, and the numbers don't move", changes() === changesBefore && again.text === after.text, `${changesBefore} -> ${changes()}`);

    // ── Refusals ──────────────────────────────────────────────────────────────
    const refused = (r: { s: number; j: any; text: string }) => r.s === 403 && r.j.error === "Forbidden" && !/\d/.test(r.text);
    const none = await get(URL_PATH);
    check("12. no secret: refused, with no numbers", refused(none), `${none.s} ${none.text.slice(0, 100)}`);
    const wrong = await get(URL_PATH, { "x-admin-secret": `${ADMIN}-wrong` });
    check("13. the wrong secret: refused", refused(wrong), `${wrong.s}`);
    const empty = await get(URL_PATH, { "x-admin-secret": "" });
    check("14. an empty secret: refused", refused(empty), `${empty.s}`);
    const inUrl = await get(`${URL_PATH}?secret=${encodeURIComponent(ADMIN)}`);
    check("15. the secret in the URL isn't accepted, so it can't land in a log", refused(inUrl), `${inUrl.s}`);
    const reg = await (await fetch(`${base}/api/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: `zaudit-signedin-${stamp}@example.test`, password: "Testpass123", name: "Zaudit Signedin", hipaa_acknowledged: true }) })).json() as any;
    const signedIn = await get(URL_PATH, { Authorization: `Bearer ${reg.token}` });
    check("16. a signed-in user with no secret: refused", !!reg.token && refused(signedIn), `${signedIn.s}`);

    // A server with no secret set must refuse too: no secret in the request must not count as matching no secret on the server.
    const saved = process.env.ADMIN_SECRET;
    delete process.env.ADMIN_SECRET;
    const unsetApp = express();
    unsetApp.use(express.json());
    const unsetServer = http.createServer(unsetApp);
    await registerRoutes(unsetServer, unsetApp);
    process.env.ADMIN_SECRET = saved;
    await new Promise<void>((r) => unsetServer.listen(0, r));
    const unsetAddr = unsetServer.address();
    const unsetRes = await fetch(`http://127.0.0.1:${typeof unsetAddr === "object" && unsetAddr ? unsetAddr.port : 0}${URL_PATH}`);
    const unsetText = await unsetRes.text();
    check("17. a server with no secret set: a request with no secret is refused", unsetRes.status === 403 && !/\d/.test(unsetText), `${unsetRes.status} ${unsetText.slice(0, 100)}`);
    unsetServer.close();
  } finally {
    server.close();
  }
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
