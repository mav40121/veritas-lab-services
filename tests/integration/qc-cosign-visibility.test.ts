// tests/integration/qc-cosign-visibility.test.ts
//
// Receipt for BUG-077 (2026-10-27): the monthly QC co-sign button showed only to the designated medical director,
// while POST /qc/period-reviews/md-cosign also accepts a delegate holding the QC co-sign responsibility for the test's
// complexity, and the owner as a logged override. GET /qc/period-reviews now reports cosignAs by the same rule, and
// for every role the GET's answer matches what the POST does.
//
// Boots the REAL routes on a scratch DB (made-up rows only). Run: npm run test:qc-cosign-visibility
import http from "node:http";
import express from "express";
import { createRequire } from "node:module";
(globalThis as any).require ??= createRequire(import.meta.url);

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  :: " + detail : ""}`);
  if (!cond) failures++;
}

async function main() {
  const { db } = await import("../../server/db");
  const { registerRoutes } = await import("../../server/routes");
  const sqlite = (db as any).$client;
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  const server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  const j = async (r: Response) => { try { return await r.json(); } catch { return {}; } };
  const stamp = Date.now();
  const register = async (tag: string) => {
    const email = `qc-cosign-${tag}-${stamp}@example.com`;
    const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Testpass123", name: `QC ${tag}`, hipaa_acknowledged: true }) }));
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
  };

  const owner = await register("owner");
  const labId = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: owner.email, labName: "QC Cosign Lab", plan: "hospital" }) }))).labId);
  const md = await register("md"), ts = await register("ts"), tc = await register("tc"), staff = await register("staff");
  const now = new Date().toISOString();
  for (const u of [md, ts, tc, staff]) {
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)").run(labId, u.id, now, now, now);
  }
  sqlite.prepare("UPDATE labs SET medical_director_email = ?, qc_md_cosign_required = 1 WHERE id = ?").run(md.email, labId);
  const letter = (u: { id: number }, position: string) => sqlite.prepare(
    "INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, status, signed_at, created_at, updated_at) VALUES (?, ?, 'Made-Up Delegate', ?, 'high', ?, 'active', ?, ?, ?)"
  ).run(labId, u.id, position, JSON.stringify({ qc_period_cosign: true }), now, now, now);
  letter(ts, "technical_supervisor");
  letter(tc, "technical_consultant"); // a TC covers moderate only; this analyte has no map row, so it resolves to high
  const lot = Number(sqlite.prepare("INSERT INTO qc_control_lots (lab_id, analyte, level, lot_number, mfr_mean, mfr_sd) VALUES (?, 'Glucose', 'mid', 'LOT-QC-1', 100, 3)").run(labId).lastInsertRowid);
  const hdr = (t: string) => ({ Authorization: `Bearer ${t}`, "X-Active-Lab-Id": String(labId), "Content-Type": "application/json" });
  const filed = await fetch(base + `/api/labs/${labId}/qc/period-reviews`, { method: "POST", headers: hdr(owner.token),
    body: JSON.stringify({ control_lot_id: lot, period_year: 2026, period_month: 9, attestation_acknowledged: true }) });
  check("0. setup: lab, five users, a lot and a filed review", labId > 0 && lot > 0 && filed.status === 200, `filed=${filed.status}`);

  const cases: [string, { token: string }, string | null][] = [
    ["the designated medical director", md, "medical_director"],
    ["a technical supervisor delegated the QC co-sign", ts, "designee"],
    ["a technical consultant delegated it, on a high-complexity test", tc, null],
    ["a staff member with no letter", staff, null],
    ["the account owner", owner, "owner_override"],
  ];
  let n = 1;
  for (const [who, u, want] of cases) {
    const g = await j(await fetch(base + `/api/labs/${labId}/qc/period-reviews?control_lot_id=${lot}`, { headers: hdr(u.token) }));
    // Reset the co-sign so each role's POST is tried on an unsigned review.
    sqlite.prepare("UPDATE qc_period_reviews SET md_signed_at = NULL, md_signed_by_user_id = NULL, md_signed_name = NULL WHERE lab_id = ?").run(labId);
    const p = await fetch(base + `/api/labs/${labId}/qc/period-reviews/md-cosign`, { method: "POST", headers: hdr(u.token),
      body: JSON.stringify({ control_lot_id: lot, period_year: 2026, period_month: 9 }) });
    const pb = await j(p);
    const postAs = p.status === 200 ? pb.signed_as : null;
    check(`${n}. ${who}: the page offers ${want ?? "no button"}, and the server agrees`, (g.cosignAs ?? null) === want && postAs === want,
      `get=${g.cosignAs ?? null} post=${p.status}/${postAs}`);
    n++;
  }

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
