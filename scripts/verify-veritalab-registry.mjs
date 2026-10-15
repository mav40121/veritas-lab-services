// scripts/verify-veritalab-registry.mjs
//
// VeritaLab CLIA site registry (St. Charles REQ-072, 2026-10-14). Boots the built server on a COPY of a
// production backup (never written) and checks, on Michaels Lab (lab 3; LAB= to change):
//   1. a contact without a name is refused; 2. a contact with a bad email is refused
//   3. a second primary contact takes over as the only primary
//   4. a director without a start date, or ending before it starts, is refused
//   5. a new director closes the open record before it (one current director)
//   6. a fee without a due date, with an unknown fee type, or a negative amount is refused
//   7. a menu change reported to CMS before it happened is refused
//   8. the registry returns all four lists for the site
//   9. the all-sites overview flags the site: overdue fee, director and menu change not reported to CMS
//  10. paying the fee and reporting both changes clears those flags
//  11. another lab's record is not found through this lab (404)
//  12. a staff login can read the registry but cannot add to it (403)
//  13. a CLIA certificate saves its link and certificate type; a non-web link and an unknown type are refused
//  14. a certificate edit that leaves the two fields out keeps them; an empty link clears it
//  15. the overview lists only labs the person manages
// Usage: node scripts/verify-veritalab-registry.mjs <backup.db>   (after npm run build)
//   DIST=<other dist/index.cjs> runs the same checks against another build (harness-bites run).
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const jwt = require("jsonwebtoken");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const DIST = process.env.DIST || path.join(ROOT, "dist", "index.cjs"), PORT = 5185, SECRET = "registry-local";
let fails = 0;
const check = (label, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  ${detail}`}`); if (!ok) fails++; };
if (!process.argv[2] || !fs.existsSync(DIST)) { console.error("usage: node scripts/verify-veritalab-registry.mjs <backup.db> (after npm run build)"); process.exit(2); }

const LAB = Number(process.env.LAB || 3);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "registry-")); const dbPath = path.join(dir, "copy.db"); fs.copyFileSync(process.argv[2], dbPath);
const ro = new Database(dbPath, { readonly: true });
const owner = ro.prepare("SELECT owner_user_id FROM labs WHERE id = ?").get(LAB).owner_user_id;
const staff = ro.prepare("SELECT user_id FROM lab_members WHERE lab_id = ? AND role = 'staff' AND status = 'active' AND COALESCE(permissions_json, '{}') NOT LIKE '%edit%' ORDER BY id LIMIT 1").get(LAB);
// A lab whose owner is not a member of LAB and not an admin of its organization.
const other = ro.prepare(`SELECT l.id, l.owner_user_id FROM labs l WHERE l.id <> ? AND l.retired_at IS NULL AND l.plan IN ('hospital','enterprise','community','clinic')
  AND l.owner_user_id <> ? AND NOT EXISTS (SELECT 1 FROM lab_members m WHERE m.lab_id = ? AND m.user_id = l.owner_user_id AND m.status = 'active') ORDER BY l.id LIMIT 1`).get(LAB, owner, LAB);
ro.close();
const child = spawn(process.execPath, [DIST], { env: { ...process.env, DB_PATH: dbPath, PORT: String(PORT), NODE_ENV: "production", JWT_SECRET: SECRET, ADMIN_SECRET: SECRET, STRIPE_SECRET_KEY: "sk_test_dummy", STRIPE_WEBHOOK_SECRET: "whsec_dummy" }, stdio: "ignore" });
let up = false;
for (let i = 0; i < 90 && !up; i++) { await new Promise((r) => setTimeout(r, 1000)); try { up = (await fetch(`http://localhost:${PORT}/api/health`)).status === 200; } catch {} }
if (!up) { console.error("server did not start"); child.kill(); process.exit(2); }
const done = async () => { child.kill(); await new Promise((r) => setTimeout(r, 1000)); fs.rmSync(dir, { recursive: true, force: true }); };

const hdr = (userId, lab) => ({ "Content-Type": "application/json", Authorization: `Bearer ${jwt.sign({ userId }, SECRET, { expiresIn: "10m" })}`, "X-Active-Lab-Id": String(lab) });
const H = hdr(owner, LAB);
const API = `http://localhost:${PORT}/api`;
const R = `${API}/labs/${LAB}/veritalab/registry`;
const j = async (r) => { try { return await r.json(); } catch { return {}; } };
const send = (url, body, method = "POST", h = H) => fetch(url, { method, headers: h, body: JSON.stringify(body) });
const site = async () => ((await j(await fetch(`${API}/veritalab/sites-overview`, { headers: H }))).sites || []).find((s) => s.lab_id === LAB);

// 1-3 contacts
const c0 = await send(`${R}/contacts`, { role: "Supervisor" });
check("1. a contact without a name is refused", c0.status === 400, String(c0.status));
const c1 = await send(`${R}/contacts`, { name: "QA Contact", email: "not-an-email" });
check("2. a contact with a bad email is refused", c1.status === 400, String(c1.status));
const a = await j(await send(`${R}/contacts`, { name: "QA Primary A", role: "Site supervisor", phone: "555-0100", email: "qa.a@example.org", is_primary: true }));
const b = await j(await send(`${R}/contacts`, { name: "QA Primary B", role: "POC coordinator", is_primary: true }));
const reg1 = await j(await fetch(R, { headers: H }));
const prim = (reg1.contacts || []).filter((c) => c.is_primary === 1).map((c) => c.id);
check("3. a second primary contact takes over as the only primary", a.id && b.id && prim.length === 1 && prim[0] === b.id, JSON.stringify(prim));

// 4-5 directors
const d0 = await send(`${R}/directors`, { director_name: "QA Director" });
const d0b = await send(`${R}/directors`, { director_name: "QA Director", start_date: "2026-05-01", end_date: "2026-04-01" });
check("4. a director without a start date, or ending before it starts, is refused", d0.status === 400 && d0b.status === 400, `${d0.status}/${d0b.status}`);
const dA = await j(await send(`${R}/directors`, { director_name: "QA Director One, MD", start_date: "2024-01-01", cms_notified_date: "2024-01-15" }));
const dB = await j(await send(`${R}/directors`, { director_name: "QA Director Two, MD", start_date: "2026-09-01" }));
const reg2 = await j(await fetch(R, { headers: H }));
const rowA = (reg2.directors || []).find((x) => x.id === dA.id);
check("5. a new director closes the open record before it", rowA?.end_date === "2026-09-01" && !(reg2.directors || []).find((x) => x.id === dB.id)?.end_date, JSON.stringify(rowA));

// 6 fees
const f0 = await send(`${R}/fees`, { fee_type: "certificate", amount: 180 });
const f1 = await send(`${R}/fees`, { fee_type: "lunch", due_date: "2026-01-01" });
const f2 = await send(`${R}/fees`, { fee_type: "certificate", amount: -5, due_date: "2026-01-01" });
check("6. a fee without a due date, with an unknown type, or a negative amount is refused", f0.status === 400 && f1.status === 400 && f2.status === 400, `${f0.status}/${f1.status}/${f2.status}`);
const fee = await j(await send(`${R}/fees`, { fee_type: "compliance_survey", reference: "QA-COUPON-1", amount: 1234.5, invoice_date: "2026-08-01", due_date: "2026-09-15" }));

// 7 menu changes
const m0 = await send(`${R}/menu-changes`, { change_type: "test_added", description: "QA added A1c", change_date: "2026-10-01", cms_notified_date: "2026-09-01" });
check("7. a menu change reported to CMS before it happened is refused", m0.status === 400, String(m0.status));
const mc = await j(await send(`${R}/menu-changes`, { change_type: "test_added", description: "QA added hemoglobin A1c", change_date: "2026-10-01" }));

// 8-10 registry + overview
const reg3 = await j(await fetch(R, { headers: H }));
check("8. the registry returns all four lists", ["contacts", "directors", "fees", "menu_changes"].every((k) => Array.isArray(reg3[k]) && reg3[k].length > 0), Object.keys(reg3).join(","));
const s1 = await site();
const att1 = s1?.attention || [];
check("9. the overview flags the overdue fee and the changes not reported to CMS",
  att1.some((x) => /fee payment overdue/.test(x)) && att1.some((x) => /Director change not yet reported/.test(x)) && att1.some((x) => /test menu change/.test(x)) && s1.director === "QA Director Two, MD" && s1.contact?.name === "QA Primary B",
  JSON.stringify(s1));
await send(`${R}/fees/${fee.id}`, { paid_date: "2026-09-10", confirmation: "QA-PAY-1" }, "PUT");
await send(`${R}/directors/${dB.id}`, { cms_notified_date: "2026-09-20" }, "PUT");
await send(`${R}/menu-changes/${mc.id}`, { cms_notified_date: "2026-10-05" }, "PUT");
const att2 = (await site())?.attention || [];
check("10. paying the fee and reporting both changes clears those flags",
  !att2.some((x) => /fee payment overdue|not yet reported/.test(x)), JSON.stringify(att2));

// 11 cross-lab
if (other) {
  const HO = hdr(other.owner_user_id, other.id);
  const oc = await j(await send(`${API}/labs/${other.id}/veritalab/registry/contacts`, { name: "QA other lab contact" }, "POST", HO));
  const x = await send(`${R}/contacts/${oc.id}`, { name: "hijack" }, "PUT");
  const xd = await fetch(`${R}/contacts/${oc.id}`, { method: "DELETE", headers: H });
  check("11. another lab's record is not found through this lab", !!oc.id && x.status === 404 && xd.status === 404, `${oc.id} ${x.status}/${xd.status}`);
} else console.log("SKIP  11. no second lab on this copy");

// 12 staff
if (staff) {
  const HS = hdr(staff.user_id, LAB);
  const g = await fetch(R, { headers: HS });
  const p = await send(`${R}/contacts`, { name: "QA staff contact" }, "POST", HS);
  check("12. a staff login can read the registry but cannot add to it", g.status === 200 && p.status === 403, `read ${g.status}, add ${p.status}`);
} else console.log("SKIP  12. no staff member on this lab in the copy");

// 13-14 certificates
const C = `${API}/labs/${LAB}/veritalab/certificates`;
const cert = await j(await send(C, { cert_type: "clia", cert_name: "QA CLIA Certificate", cert_number: "99D9999999", expiration_date: "2028-06-30", clia_certificate_type: "accreditation", link_url: "https://example.org/qa-clia.pdf" }));
const cbad1 = await send(C, { cert_type: "clia", cert_name: "QA bad link", link_url: "ftp://example.org/x" });
const cbad2 = await send(C, { cert_type: "clia", cert_name: "QA bad type", clia_certificate_type: "gold" });
check("13. a CLIA certificate saves its link and type; a non-web link and an unknown type are refused",
  cert.link_url === "https://example.org/qa-clia.pdf" && cert.clia_certificate_type === "accreditation" && cbad1.status === 400 && cbad2.status === 400,
  `${JSON.stringify({ link: cert.link_url, type: cert.clia_certificate_type })} ${cbad1.status}/${cbad2.status}`);
const keep = await j(await send(`${C}/${cert.id}`, { notes: "QA edit" }, "PUT"));
const clear = await j(await send(`${C}/${cert.id}`, { link_url: "" }, "PUT"));
check("14. an edit without the two fields keeps them; an empty link clears it",
  keep.link_url === "https://example.org/qa-clia.pdf" && keep.clia_certificate_type === "accreditation" && clear.link_url === null && clear.clia_certificate_type === "accreditation",
  JSON.stringify({ keep: [keep.link_url, keep.clia_certificate_type], clear: [clear.link_url, clear.clia_certificate_type] }));

// 15 overview scope
if (other) {
  const ov = await j(await fetch(`${API}/veritalab/sites-overview`, { headers: hdr(other.owner_user_id, other.id) }));
  const ids = (ov.sites || []).map((s) => s.lab_id);
  check("15. the overview lists only labs the person manages", ids.includes(other.id) && !ids.includes(LAB), JSON.stringify(ids));
} else console.log("SKIP  15. no second lab on this copy");

await done();
console.log(fails ? `\n${fails} FAIL` : "\nALL PASS");
process.exit(fails ? 1 : 0);
