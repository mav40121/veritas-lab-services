// tests/integration/finding-signoff-history.test.ts
//
// Receipt for BUG-080 (2026-10-27), VeritaResponse sign-off:
//   - GET /findings/:id/history reports signoffAs by the same rule as POST /signoff (the designated medical director, a
//     delegate holding finding closure for the lab's complexity, or the owner as a logged override). For each role,
//     the page's answer matches what the POST does, so the button shows to exactly the people the server accepts.
//   - The same route returns the finding's history (saved before, never shown): newest first, named, with the payload.
//
// Boots the REAL routes on a scratch DB (made-up rows only). Run: npm run test:finding-signoff-history
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
    const email = `finding-so-${tag}-${stamp}@example.com`;
    const reg = await j(await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "Testpass123", name: `Made-Up ${tag.toUpperCase()}`, hipaa_acknowledged: true }) }));
    return { email, token: reg.token as string, id: Number((sqlite.prepare("SELECT id FROM users WHERE email = ?").get(email) as any)?.id) };
  };

  const owner = await register("owner");
  const labId = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: owner.email, labName: "Finding Signoff Lab", plan: "hospital" }) }))).labId);
  const md = await register("md"), ts = await register("ts"), staff = await register("staff");
  const now = new Date().toISOString();
  for (const u of [md, ts, staff]) {
    sqlite.prepare("INSERT INTO lab_members (lab_id, user_id, role, status, is_primary_lab, accepted_at, created_at, updated_at) VALUES (?, ?, 'staff', 'active', 1, ?, ?, ?)").run(labId, u.id, now, now, now);
  }
  sqlite.prepare("UPDATE labs SET medical_director_email = ? WHERE id = ?").run(md.email, labId);
  sqlite.prepare("INSERT INTO director_delegations (lab_id, delegate_user_id, delegate_name, position, complexity_scope, responsibilities_json, status, signed_at, created_at, updated_at) VALUES (?, ?, 'Made-Up TS', 'technical_supervisor', 'high', ?, 'active', ?, ?, ?)")
    .run(labId, ts.id, JSON.stringify({ finding_closure: true }), now, now, now);
  const hdr = (t: string) => ({ Authorization: `Bearer ${t}`, "X-Active-Lab-Id": String(labId), "Content-Type": "application/json" });
  const mk = async () => Number((await j(await fetch(base + `/api/labs/${labId}/findings`, { method: "POST", headers: hdr(owner.token),
    body: JSON.stringify({ accreditor: "CMS", description: "Made-up finding", anchor_date: "2026-10-01" }) }))).id);

  const fid = await mk();
  const put = await fetch(base + `/api/labs/${labId}/findings/${fid}`, { method: "PUT", headers: hdr(owner.token),
    body: JSON.stringify({ accreditor: "CMS", root_cause: "Made-up root cause", corrective_action: "Made-up action" }) });
  check("0. setup: lab, four users, a finding created and edited", labId > 0 && fid > 0 && put.status === 200, `put=${put.status}`);

  const cases: [string, { token: string }, string | null][] = [
    ["the designated medical director", md, "medical_director"],
    ["a technical supervisor delegated finding closure", ts, "designee"],
    ["a staff member with no letter", staff, null],
    ["the account owner", owner, "owner_override"],
  ];
  let n = 1;
  for (const [who, u, want] of cases) {
    const id = await mk();
    const g = await j(await fetch(base + `/api/labs/${labId}/findings/${id}/history`, { headers: hdr(u.token) }));
    const p = await fetch(base + `/api/labs/${labId}/findings/${id}/signoff`, { method: "POST", headers: hdr(u.token), body: "{}" });
    const pb = await j(p);
    const postAs = p.status === 200 ? pb.signoff_role : null;
    check(`${n}. ${who}: the page offers ${want ?? "no button"}, and the server agrees`, (g.signoffAs ?? null) === want && postAs === want,
      `get=${g.signoffAs ?? null} post=${p.status}/${postAs}`);
    n++;
  }

  // History on the first finding: sign it off as the MD, then read it back.
  await fetch(base + `/api/labs/${labId}/findings/${fid}/signoff`, { method: "POST", headers: hdr(md.token), body: "{}" });
  const h = await j(await fetch(base + `/api/labs/${labId}/findings/${fid}/history`, { headers: hdr(staff.token) }));
  const ev = (h.events || []) as any[];
  check(`${n++}. history lists created, updated and signed_off, newest first`, ev.map((e) => e.event).join(",") === "signed_off,updated,created", ev.map((e) => e.event).join(","));
  const so = ev[0] || {}, up = ev[1] || {};
  check(`${n++}. each event carries who made it and its payload`, so.by_name === "Made-Up MD" && so.payload?.signoff_role === "medical_director"
    && up.by_name === "Made-Up OWNER" && Array.isArray(up.payload?.changed) && up.payload.changed.includes("root_cause"), JSON.stringify({ so: [so.by_name, so.payload], up: [up.by_name, up.payload] }));
  check(`${n++}. any member can read it (a staff member did)`, Array.isArray(h.events) && h.signoffAs === null);

  // Another lab cannot read this finding's history.
  const other = await register("other");
  const otherLab = Number((await j(await fetch(base + "/api/admin/provision-demo-lab", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: process.env.ADMIN_SECRET, ownerEmail: other.email, labName: "Other Lab", plan: "hospital" }) }))).labId);
  const x = await fetch(base + `/api/labs/${otherLab}/findings/${fid}/history`, { headers: { Authorization: `Bearer ${other.token}`, "X-Active-Lab-Id": String(otherLab) } });
  check(`${n++}. another lab gets 404 for this finding's history`, x.status === 404, `status=${x.status}`);

  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
